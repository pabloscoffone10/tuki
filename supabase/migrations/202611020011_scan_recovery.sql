-- Block 1: private, recoverable receipt scans. Apply once after 001-010.
-- No financial data rewrites, remote API calls or files stored in this cache.
begin;
do $$ begin
 if pg_catalog.to_regclass('public.receipt_scan_requests') is null
 or pg_catalog.to_regclass('public.notifications') is null
 or pg_catalog.to_regprocedure('public.tuki_prepare_payment(uuid,jsonb,boolean)') is null then raise exception 'phase6_required';end if;
end $$;

create table tuki_private.scan_jobs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 group_id uuid not null references public.groups(id) on delete cascade,
 hash text not null check(hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'pending' check(status in('pending','processing','completed','failed','recoverable')),
 lease uuid,lease_until timestamptz,retry_after timestamptz,
 attempts integer not null default 0 check(attempts>=0),
 result jsonb,error_code text check(error_code in('provider_failed','outcome_unknown')),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null default clock_timestamp()+interval '1 day',
 unique(user_id,group_id,hash),
 check(result is null or (status='completed' and jsonb_typeof(result)='object' and octet_length(result::text)<=200000)),
 check(status<>'completed' or result is not null)
);
create index scan_jobs_expiration on tuki_private.scan_jobs(expires_at);
alter table tuki_private.scan_jobs enable row level security;
revoke all on tuki_private.scan_jobs from public,anon,authenticated;

create function public.tuki_begin_scan(p_group_id uuid,p_hash text,p_provider_enabled boolean,p_retry boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job tuki_private.scan_jobs; lease_id uuid; now_at timestamptz:=clock_timestamp();
begin
 perform public.tuki_ensure_person();
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_input';end if;
 -- Same group row used by membership changes; permissions are checked after it.
 perform id from public.groups where id=p_group_id for update;
 if not found or not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501';end if;
 -- Shares the original quota lock, so old/new clients cannot race limits.
 -- This short lock is released before any provider/network request.
 lock table public.receipt_scan_requests in share row exclusive mode;
 select * into job from tuki_private.scan_jobs where user_id=auth.uid() and group_id=p_group_id and hash=p_hash for update;
 if found then
  if job.status='completed' and job.expires_at>now_at then return jsonb_build_object('id',job.id,'status','completed','extraction',job.result);end if;
  if job.status='processing' and job.lease_until>now_at then return jsonb_build_object('id',job.id,'status','processing');end if;
  if job.status='processing' then
   update tuki_private.scan_jobs set status='recoverable',error_code='outcome_unknown',updated_at=now_at where id=job.id;
   job.status:='recoverable';
  end if;
  if job.status='recoverable' and p_retry is distinct from true then return jsonb_build_object('id',job.id,'status','recoverable');end if;
  if job.status in('failed','recoverable') and job.retry_after>now_at then return jsonb_build_object('id',job.id,'status',job.status,'cooldown',true);end if;
 end if;
 -- Cached results remain recoverable even when the provider is disabled.
 if p_provider_enabled is distinct from true then return jsonb_build_object('status','pending');end if;
 if (select count(*) from public.receipt_scan_requests where user_id=auth.uid() and created_at>now_at-interval '1 day')>=10
 or (select count(*) from public.receipt_scan_requests where user_id=auth.uid() and created_at>now_at-interval '1 minute')>=2
 or (select count(*) from public.receipt_scan_requests where created_at>now_at-interval '1 day')>=200 then raise exception 'scan_limit';end if;
 lease_id:=gen_random_uuid();
 insert into tuki_private.scan_jobs(user_id,group_id,hash,status,lease,lease_until,attempts)
 values(auth.uid(),p_group_id,p_hash,'processing',lease_id,now_at+interval '2 minutes',1)
 on conflict(user_id,group_id,hash) do update set status='processing',lease=excluded.lease,lease_until=excluded.lease_until,
 attempts=scan_jobs.attempts+1,result=null,error_code=null,retry_after=null,updated_at=now_at,expires_at=now_at+interval '1 day'
 returning * into job;
 insert into public.receipt_scan_requests(user_id,hash) values(auth.uid(),p_hash);
 return jsonb_build_object('id',job.id,'status','processing','acquired',true,'lease',lease_id);
end; $$;

create function public.tuki_finish_scan(p_id uuid,p_lease uuid,p_result jsonb default null,p_failure text default null) returns void
language plpgsql security definer set search_path='' as $$
declare job tuki_private.scan_jobs;
begin
 perform public.tuki_ensure_person();
 select * into job from tuki_private.scan_jobs where id=p_id and user_id=auth.uid();
 if not found then raise exception 'scan_forbidden' using errcode='42501';end if;
 -- Lock order is group, then job, including group deletion/cascade.
 perform id from public.groups where id=job.group_id for update;
 if not found or not tuki_private.is_member(job.group_id) then raise exception 'scan_forbidden' using errcode='42501';end if;
 select * into job from tuki_private.scan_jobs where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'scan_forbidden' using errcode='42501';end if;
 if p_lease is null or job.lease is distinct from p_lease then raise exception 'scan_conflict';end if;
 if job.status='completed' and p_failure is null and job.result=p_result then return;end if;
 if job.status not in('processing','recoverable') then raise exception 'scan_conflict';end if;
 if p_failure is null then
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>200000
  or jsonb_typeof(p_result->'items') is distinct from 'array' or jsonb_array_length(p_result->'items')>80
  or jsonb_typeof(p_result->'adjustments') is distinct from 'array' or jsonb_array_length(p_result->'adjustments')>12
  or jsonb_typeof(p_result->'warnings') is distinct from 'array' or jsonb_array_length(p_result->'warnings')>20
  or jsonb_typeof(p_result->'complete') is distinct from 'boolean' then raise exception 'invalid_extraction';end if;
  update tuki_private.scan_jobs set status='completed',result=p_result,error_code=null,retry_after=null,
  lease_until=null,updated_at=clock_timestamp(),expires_at=clock_timestamp()+interval '1 day' where id=p_id;
 else
  if p_result is not null or p_failure not in('provider_failed','outcome_unknown') then raise exception 'invalid_input';end if;
  update tuki_private.scan_jobs set status=case when p_failure='outcome_unknown' then 'recoverable' else 'failed' end,
  result=null,error_code=p_failure,retry_after=clock_timestamp()+interval '1 minute',lease_until=null,updated_at=clock_timestamp() where id=p_id;
 end if;
end; $$;

-- Operator-only retention: schedule or run daily. Never exposed to browsers.
create function public.tuki_purge_expired_scans() returns integer language plpgsql security definer set search_path='' as $$
declare removed integer;
begin
 delete from tuki_private.scan_jobs where expires_at<clock_timestamp() and(status<>'processing' or lease_until<clock_timestamp());
 get diagnostics removed=row_count;return removed;
end; $$;
revoke all on function public.tuki_begin_scan(uuid,text,boolean,boolean),public.tuki_finish_scan(uuid,uuid,jsonb,text),public.tuki_purge_expired_scans() from public,anon,authenticated;
grant execute on function public.tuki_begin_scan(uuid,text,boolean,boolean),public.tuki_finish_scan(uuid,uuid,jsonb,text) to authenticated;
grant execute on function public.tuki_purge_expired_scans() to service_role;
-- All paid calls now use recoverable attempts; retire the opaque reservation RPC.
revoke all on function public.tuki_reserve_scan(uuid,text) from public,anon,authenticated;
-- A private scan cache is disposable when its financially empty group is deleted.
-- Only its explicitly cascading group FK is accepted; unknown references still block.
create or replace function tuki_private.removal_schema_known() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions','receipt_scan_requests','payments','payment_allocations','payment_events','notifications','notification_preferences'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass) and n.nspname<>'public' and not((n.nspname='tuki_private' and r.relname in('notification_outbox','reminder_log','automatic_reminder_runs')) or(n.nspname='tuki_private' and r.relname='scan_jobs' and c.confrelid='public.groups'::regclass and c.confdeltype='c')))
$$;
notify pgrst,'reload schema';
commit;
