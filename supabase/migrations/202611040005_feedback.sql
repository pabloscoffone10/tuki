begin;
-- Isolated from financial entities and removal guards. No client access.
create table tuki_private.feedback_reports (
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users(id) on delete set null,
 category text not null check(category in ('sugerencia','error','consulta','otros')),
 description text not null check(length(btrim(description)) between 1 and 4000),
 email text check(email is null or length(email) between 3 and 254),
 created_at timestamptz not null default now(),
 sent_at timestamptz, attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(), lease uuid,
 last_error text check(length(last_error)<=100)
);
create table tuki_private.feedback_limits (bucket text primary key, started_at timestamptz not null, count integer not null);
alter table tuki_private.feedback_reports enable row level security;
alter table tuki_private.feedback_limits enable row level security;
revoke all on tuki_private.feedback_reports,tuki_private.feedback_limits from public,anon,authenticated;
create index feedback_pending on tuki_private.feedback_reports(next_attempt_at) where sent_at is null;
create function public.tuki_submit_feedback(p_user uuid,p_category text,p_description text,p_email text,p_bucket text) returns uuid
language plpgsql security definer set search_path='' as $$
declare n integer; result uuid; b text;
begin
 if p_bucket is null or length(p_bucket)>64 then raise exception 'invalid_bucket'; end if;
 -- Serialize global and sender quotas across server instances; transaction rolls back on rejection.
 foreach b in array array['global', 'sender:'||p_bucket] loop
  insert into tuki_private.feedback_limits as l values(b,now(),1)
  on conflict(bucket) do update set started_at=case when l.started_at<now()-interval '1 hour' then now() else l.started_at end,
  count=case when l.started_at<now()-interval '1 hour' then 1 else l.count+1 end returning count into n;
  if n>(case when b='global' then 100 else 5 end) then raise exception 'feedback_rate_limit'; end if;
 end loop;
 insert into tuki_private.feedback_reports(user_id,category,description,email) values(p_user,p_category,p_description,nullif(p_email,'')) returning id into result;
 return result;
end $$;
create function public.tuki_claim_feedback(p_id uuid default null) returns setof tuki_private.feedback_reports
language sql security definer set search_path='' as $$
 update tuki_private.feedback_reports set lease=gen_random_uuid(),attempts=attempts+1,next_attempt_at=now()+interval '5 minutes'
 where id in (select id from tuki_private.feedback_reports where sent_at is null and next_attempt_at<=now() and (p_id is null or id=p_id) order by created_at limit 10 for update skip locked)
 returning *;
$$;
create function public.tuki_finish_feedback(p_id uuid,p_lease uuid,p_error text) returns void
language sql security definer set search_path='' as $$
 update tuki_private.feedback_reports set sent_at=case when p_error is null then now() else null end,
 last_error=p_error,lease=null,next_attempt_at=now()+interval '1 hour'
 where id=p_id and lease=p_lease and sent_at is null;
$$;
revoke all on function public.tuki_submit_feedback(uuid,text,text,text,text),public.tuki_claim_feedback(uuid),public.tuki_finish_feedback(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.tuki_submit_feedback(uuid,text,text,text,text),public.tuki_claim_feedback(uuid),public.tuki_finish_feedback(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
