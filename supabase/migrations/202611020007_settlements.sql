-- Phase 5. Apply once after 001-006. Records external payments only.
begin;
do $$ begin
 if pg_catalog.to_regclass('public.smart_bill_revisions') is null or pg_catalog.to_regprocedure('public.tuki_void_expense(uuid,integer,boolean)') is null then
  raise exception 'phase45_required: apply migrations 001-006 first';
 end if;
end $$;
-- One short, database-only critical section for financial mutations. All entry
-- points acquire this BEFORE any group/payment locks; never held over network IO.
create table tuki_private.finance_gate(id boolean primary key check(id));
insert into tuki_private.finance_gate values(true);
revoke all on tuki_private.finance_gate from public,anon,authenticated;
create function tuki_private.lock_finance() returns void language sql security definer set search_path='' as $$ select id from tuki_private.finance_gate for update $$;
revoke all on function tuki_private.lock_finance() from public,anon,authenticated;

create table public.payments (
 id uuid primary key, payer_id uuid not null references public.persons(id), receiver_id uuid not null references public.persons(id),
 amount_minor numeric(16,0) not null check(amount_minor>0 and amount_minor<=100000000000000), payment_date date not null,
 method text not null check(method in ('cash','bank','other')), note text not null check(char_length(note)<=1000), reference text not null check(char_length(reference)<=120),
 group_id uuid references public.groups(id), scope text not null check(scope in ('global','group')),
 created_by uuid not null references public.persons(id), approver_id uuid not null references public.persons(id),
 status text not null default 'pending' check(status in ('pending','confirmed','rejected','void')), version integer not null default 1 check(version>0),
 selected_obligations uuid[] not null default '{}', request_hash text not null,
 created_at timestamptz not null default clock_timestamp(), confirmed_by uuid references public.persons(id), confirmed_at timestamptz,
 approval_mode text check(approval_mode in ('counterparty','administrative')), receipt_data bytea, receipt_mime text,
 check(payer_id<>receiver_id),check(scope<>'group' or group_id is not null),check(created_by<>approver_id),
 check(cardinality(selected_obligations)<=100), check(receipt_data is null or octet_length(receipt_data)<=524288),
 check((confirmed_by is null)=(confirmed_at is null)), check(status<>'confirmed' or confirmed_by is not null)
);
create index payments_parties on public.payments(payer_id,receiver_id,status);
create table public.payment_allocations (
 payment_id uuid not null references public.payments(id), obligation_id uuid not null references public.obligations(id),
 amount_minor numeric(16,0) not null check(amount_minor>0), created_at timestamptz not null default clock_timestamp(),
 actor_id uuid not null references public.persons(id), reversed_at timestamptz, reversed_by uuid references public.persons(id),
 primary key(payment_id,obligation_id),check((reversed_at is null)=(reversed_by is null))
);
create index allocations_obligation on public.payment_allocations(obligation_id) where reversed_at is null;
create table public.payment_events (
 id uuid primary key, payment_id uuid not null references public.payments(id), actor_id uuid not null references public.persons(id),
 action text not null check(action in ('created','confirm','reject','void')), from_status text, to_status text not null,
 reason text not null, administrative boolean not null default false, request_hash text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.payments enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.payment_events enable row level security;
revoke all on public.payments,public.payment_allocations,public.payment_events from public,anon,authenticated;
grant select on public.payments,public.payment_allocations,public.payment_events to authenticated;
create function tuki_private.can_view_payment(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.payments x where x.id=p and (tuki_private.current_person() in (x.payer_id,x.receiver_id,x.created_by) or (x.scope='group' and tuki_private.is_admin(x.group_id))))
$$;
revoke all on function tuki_private.can_view_payment(uuid) from public,anon,authenticated;
grant execute on function tuki_private.can_view_payment(uuid) to authenticated;
create policy payment_read on public.payments for select to authenticated using(tuki_private.can_view_payment(id));
create policy allocations_read on public.payment_allocations for select to authenticated using(tuki_private.can_view_payment(payment_id));
create policy payment_events_read on public.payment_events for select to authenticated using(tuki_private.can_view_payment(payment_id));

create view tuki_private.open_obligations as
 select o.*,o.amount_minor-coalesce((select sum(a.amount_minor) from public.payment_allocations a join public.payments p on p.id=a.payment_id where a.obligation_id=o.id and a.reversed_at is null and p.status='confirmed'),0) as remaining_minor
 from public.obligations o;
revoke all on tuki_private.open_obligations from public,anon,authenticated;
create function tuki_private.pair_balance(payer uuid,receiver uuid,g uuid default null) returns numeric
language sql stable set search_path='' as $$
 select coalesce(sum(case when o.debtor_id=payer then o.remaining_minor else -o.remaining_minor end),0)
 from tuki_private.open_obligations o where o.active and ((o.debtor_id=payer and o.creditor_id=receiver) or (o.debtor_id=receiver and o.creditor_id=payer)) and (g is null or o.group_id=g)
$$;
revoke all on function tuki_private.pair_balance(uuid,uuid,uuid) from public,anon,authenticated;
create function tuki_private.payment_plan(payer uuid,receiver uuid,g uuid,selected uuid[],amount numeric) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb:='[]'; chosen record; left_over numeric:=amount; applied numeric;
begin
 if amount<=0 or amount>tuki_private.pair_balance(payer,receiver,null) or (g is not null and amount>tuki_private.pair_balance(payer,receiver,g)) then raise exception 'payment_over_amount'; end if;
 if cardinality(selected)>0 then
  if cardinality(selected)<>(select count(distinct id) from unnest(selected) id) or cardinality(selected)<>(select count(*) from tuki_private.open_obligations o where o.id=any(selected) and o.active and o.remaining_minor>0 and o.debtor_id=payer and o.creditor_id=receiver and (g is null or o.group_id=g)) then raise exception 'payment_selection_changed'; end if;
 end if;
 for chosen in select x.id,x.remaining_minor from tuki_private.open_obligations x join public.expenses e on e.id=x.expense_id join public.expense_revisions r on r.id=x.revision_id
 where x.active and x.remaining_minor>0 and x.debtor_id=payer and x.creditor_id=receiver and (g is null or x.group_id=g)
 and (cardinality(selected)=0 or x.id=any(selected)) order by e.created_at,r.version,x.id loop
  exit when left_over=0;
  applied:=least(chosen.remaining_minor,left_over);result:=result||jsonb_build_array(jsonb_build_object('id',chosen.id,'amount',applied::text));left_over:=left_over-applied;
 end loop;
 if left_over<>0 then raise exception 'payment_not_assignable'; end if;
 return result;
end; $$;
revoke all on function tuki_private.payment_plan(uuid,uuid,uuid,uuid[],numeric) from public,anon,authenticated;

create function public.tuki_create_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; payer uuid; receiver uuid; g uuid; payment_scope text; approver uuid; amount numeric; selected uuid[]; digest text; old public.payments; receipt bytea; mime text;
begin
 actor:=public.tuki_ensure_person();if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 perform tuki_private.lock_finance();
 digest:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');select * into old from public.payments where id=p_id;
 if found then if old.created_by=actor and old.request_hash=digest then return p_id; else raise exception 'payment_idempotency_conflict'; end if; end if;
 payer:=(p_data->>'payerId')::uuid;receiver:=(p_data->>'receiverId')::uuid;g:=(p_data->>'groupId')::uuid;
 if payer is null or receiver is null or payer=receiver or not exists(select 1 from public.persons where id=payer and merged_into is null) or not exists(select 1 from public.persons where id=receiver and merged_into is null) then raise exception 'payment_invalid_parties'; end if;
 if g is not null then
  perform id from public.groups where id=g for update;
  if not found or not (tuki_private.is_member(g) or (actor in(payer,receiver) and exists(select 1 from public.group_members where group_id=g and person_id=actor and status='retired' and replaced_by_person_id is null))) or not exists(select 1 from public.group_members where group_id=g and person_id=payer and replaced_by_person_id is null) or not exists(select 1 from public.group_members where group_id=g and person_id=receiver and replaced_by_person_id is null) then raise exception 'payment_forbidden' using errcode='42501'; end if;
 end if;
 if actor in (payer,receiver) then payment_scope:='global';
 elsif g is not null and tuki_private.is_admin(g) then payment_scope:='group';
 else raise exception 'payment_forbidden' using errcode='42501'; end if;
 approver:=case when actor=receiver then payer else receiver end;
 -- A guest cannot authorize a global settlement. Administrative attestation is
 -- restricted to this origin, even if the creator is a registered counterparty.
 if exists(select 1 from public.persons where id=approver and user_id is null) then
  if g is null then raise exception 'payment_guest_origin_required';end if;payment_scope:='group';
 end if;
 amount:=tuki_private.bill_decimal(p_data->'amount',2);
 if amount<=0 or amount>100000000000000 then raise exception 'payment_over_amount'; end if;
 if jsonb_typeof(p_data->'selected') is distinct from 'array' or jsonb_array_length(p_data->'selected')>100 then raise exception 'payment_selection_changed'; end if;
 if p_data->>'allocationMode'='manual' and jsonb_array_length(p_data->'selected')=0 then raise exception 'payment_selection_changed';end if;
 select coalesce(array_agg(value::uuid),'{}') into selected from jsonb_array_elements_text(p_data->'selected');
 perform tuki_private.payment_plan(payer,receiver,case when payment_scope='group' then g else null end,selected,amount);
 if p_data ? 'receipt' then
  receipt:=decode(p_data->'receipt'->>'data','base64');mime:=p_data->'receipt'->>'mime';
  if receipt is null or octet_length(receipt) not between 1 and 524288 or mime is null or not((mime='image/png' and encode(substring(receipt from 1 for 8),'hex')='89504e470d0a1a0a') or (mime='image/jpeg' and encode(substring(receipt from 1 for 3),'hex')='ffd8ff') or (mime='application/pdf' and encode(substring(receipt from 1 for 5),'hex')='255044462d')) then raise exception 'invalid_receipt'; end if;
 end if;
 insert into public.payments(id,payer_id,receiver_id,amount_minor,payment_date,method,note,reference,group_id,scope,created_by,approver_id,selected_obligations,request_hash,receipt_data,receipt_mime)
 values(p_id,payer,receiver,amount,(p_data->>'date')::date,p_data->>'method',coalesce(p_data->>'note',''),coalesce(p_data->>'reference',''),g,payment_scope,actor,approver,selected,digest,receipt,mime);
 insert into public.payment_events(id,payment_id,actor_id,action,to_status,reason,request_hash) values(gen_random_uuid(),p_id,actor,'created','pending','',digest);
 -- Recording from an otherwise empty shared group is still financial history.
 if g is not null then update public.groups set had_financial_activity=true where id=g; end if;
 return p_id;
end; $$;

create function public.tuki_transition_payment(p_id uuid,p_version integer,p_action text,p_reason text,p_request_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.payments; previous public.payment_events; digest text; admin_approval boolean:=false; can_approve boolean; target text; plan jsonb; part jsonb;
begin
 actor:=public.tuki_ensure_person();if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 if p_action is null or p_action not in ('confirm','reject','void') or p_reason is null or char_length(p_reason)>500 or (p_action in ('reject','void') and char_length(btrim(p_reason))<8) then raise exception 'payment_reason_required'; end if;
 perform tuki_private.lock_finance();
 digest:=encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_action,p_reason)::text,'UTF8')),'hex');
 select * into previous from public.payment_events where id=p_request_id;
 if found then if previous.actor_id=actor and previous.request_hash=digest then return; else raise exception 'payment_idempotency_conflict'; end if; end if;
 select * into p from public.payments where id=p_id for update;
 if not found or not tuki_private.can_view_payment(p_id) then raise exception 'payment_forbidden' using errcode='42501'; end if;
 if p.group_id is not null then perform id from public.groups where id=p.group_id for update; end if;
 if p.version is distinct from p_version then raise exception 'payment_conflict'; end if;
 admin_approval:=p.scope='group' and p.group_id is not null and actor<>p.created_by and actor not in (p.payer_id,p.receiver_id) and tuki_private.is_admin(p.group_id)
  and exists(select 1 from public.persons where id=p.approver_id and user_id is null and merged_into is null);
 can_approve:=actor=p.approver_id and actor<>p.created_by;
 if p_action='void' and p.status='confirmed' then
  if not ((p.approval_mode='counterparty' and actor=p.confirmed_by) or (p.approval_mode='administrative' and admin_approval)) then raise exception 'payment_forbidden' using errcode='42501'; end if;
  update public.payment_allocations set reversed_at=clock_timestamp(),reversed_by=actor where payment_id=p_id and reversed_at is null;
  target:='void';
 elsif p.status='pending' then
  if p_action='void' then
   if actor<>p.created_by and not can_approve and not admin_approval then raise exception 'payment_forbidden' using errcode='42501'; end if;target:='void';
  else
   if not can_approve and not admin_approval then raise exception 'payment_counterparty_required' using errcode='42501'; end if;
   if p_action='confirm' then
    plan:=tuki_private.payment_plan(p.payer_id,p.receiver_id,case when p.scope='group' or admin_approval then p.group_id else null end,p.selected_obligations,p.amount_minor);
    for part in select * from jsonb_array_elements(plan) loop
     insert into public.payment_allocations(payment_id,obligation_id,amount_minor,actor_id) values(p_id,(part->>'id')::uuid,(part->>'amount')::numeric,actor);
    end loop;target:='confirmed';
   else target:='rejected';end if;
  end if;
 else raise exception 'payment_conflict';end if;
 update public.payments set status=target,version=version+1,confirmed_by=case when target='confirmed' then actor else confirmed_by end,
  confirmed_at=case when target='confirmed' then clock_timestamp() else confirmed_at end,approval_mode=case when target='confirmed' then case when admin_approval then 'administrative' else 'counterparty' end else approval_mode end where id=p_id;
 insert into public.payment_events(id,payment_id,actor_id,action,from_status,to_status,reason,administrative,request_hash) values(p_request_id,p_id,actor,p_action,p.status,target,p_reason,admin_approval,digest);
end; $$;
revoke all on function public.tuki_create_payment(uuid,jsonb,boolean),public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_create_payment(uuid,jsonb,boolean),public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) to authenticated;

-- Read projections use remaining amounts; original obligations remain untouched.
alter function public.tuki_group_finances(uuid) set schema tuki_private;
alter function tuki_private.tuki_group_finances(uuid) rename to group_finances_phase4;
revoke all on function tuki_private.group_finances_phase4(uuid) from public,anon,authenticated;
create function tuki_private.remaining_projection(g uuid,actor uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'debtor_id',o.debtor_id,'creditor_id',o.creditor_id,'debtor_name',d.display_name,'creditor_name',c.display_name,'amount_minor',o.remaining_minor::text,'original_amount_minor',o.amount_minor::text,'paid_minor',(o.amount_minor-o.remaining_minor)::text,'origin_group_id',o.group_id,'origin_group_name',gr.name)),'[]')
 from tuki_private.open_obligations o join public.groups gr on gr.id=o.group_id join public.persons d on d.id=o.debtor_id join public.persons c on c.id=o.creditor_id
 where o.active and o.remaining_minor>0 and ((g is null and actor in(o.debtor_id,o.creditor_id)) or (g is not null and exists(select 1 from public.group_members m where m.group_id=g and m.person_id=o.debtor_id and m.status='active') and exists(select 1 from public.group_members m where m.group_id=g and m.person_id=o.creditor_id and m.status='active')))
$$;
revoke all on function tuki_private.remaining_projection(uuid,uuid) from public,anon,authenticated;
create function public.tuki_group_finances(p_group_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=tuki_private.group_finances_phase4(p_group_id);
 result:=jsonb_set(result,'{ledger}',coalesce((with entries as (
  select (r->>'person_id')::uuid person_id,(r->>'paid_minor')::numeric paid,(r->>'consumed_minor')::numeric consumed,0::numeric paid_off,0::numeric received from jsonb_array_elements(result->'ledger') r
  union all select p.payer_id,0,0,a.amount_minor,0 from public.payment_allocations a join public.payments p on p.id=a.payment_id join public.obligations o on o.id=a.obligation_id where p.status='confirmed' and a.reversed_at is null and o.group_id=p_group_id
  union all select p.receiver_id,0,0,0,a.amount_minor from public.payment_allocations a join public.payments p on p.id=a.payment_id join public.obligations o on o.id=a.obligation_id where p.status='confirmed' and a.reversed_at is null and o.group_id=p_group_id
 ) select jsonb_agg(row) from (select x.person_id,p.display_name,sum(x.paid)::text paid_minor,sum(x.consumed)::text consumed_minor,sum(x.paid_off)::text payment_paid_minor,sum(x.received)::text payment_received_minor,(sum(x.paid)-sum(x.consumed)+sum(x.paid_off)-sum(x.received))::text balance_minor from entries x join public.persons p on p.id=x.person_id group by x.person_id,p.display_name) row),'[]'));
 return jsonb_set(result,'{obligations}',tuki_private.remaining_projection(p_group_id,null));
end; $$;
create or replace function public.tuki_my_obligations() returns jsonb language plpgsql security definer set search_path='' as $$
begin return tuki_private.remaining_projection(null,public.tuki_ensure_person());end; $$;
revoke all on function public.tuki_group_finances(uuid),public.tuki_my_obligations() from public,anon,authenticated;
grant execute on function public.tuki_group_finances(uuid),public.tuki_my_obligations() to authenticated;

-- Protect versioned obligations, including inverse obligations used in netting.
create function tuki_private.assert_expense_unsettled(e uuid) returns void language plpgsql set search_path='' as $$
begin
 if exists(select 1 from public.obligations o join public.payments p on p.status='confirmed' and ((p.payer_id=o.debtor_id and p.receiver_id=o.creditor_id) or(p.payer_id=o.creditor_id and p.receiver_id=o.debtor_id)) where o.expense_id=e)
 then raise exception 'expense_has_confirmed_payments';end if;
end; $$;
revoke all on function tuki_private.assert_expense_unsettled(uuid) from public,anon,authenticated;
alter function public.tuki_save_expense(uuid,uuid,integer,jsonb) set schema tuki_private;
alter function tuki_private.tuki_save_expense(uuid,uuid,integer,jsonb) rename to save_expense_phase45;
revoke all on function tuki_private.save_expense_phase45(uuid,uuid,integer,jsonb) from public,anon,authenticated;
create function public.tuki_save_expense(p_id uuid,p_group_id uuid,p_expected_version integer,p_data jsonb) returns uuid language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 if exists(select 1 from public.expenses where id=p_id) and not exists(select 1 from public.expenses where id=p_id and group_id=p_group_id and tuki_private.is_member(group_id)) then raise exception 'expense_forbidden' using errcode='42501';end if;
 if exists(select 1 from public.expenses where id=p_id) and p_expected_version is distinct from 0 then perform tuki_private.assert_expense_unsettled(p_id);end if;
 return tuki_private.save_expense_phase45(p_id,p_group_id,p_expected_version,p_data);
end; $$;
alter function public.tuki_void_expense(uuid,integer,boolean) set schema tuki_private;
alter function tuki_private.tuki_void_expense(uuid,integer,boolean) rename to void_expense_phase4;
revoke all on function tuki_private.void_expense_phase4(uuid,integer,boolean) from public,anon,authenticated;
create function public.tuki_void_expense(p_id uuid,p_expected_version integer,p_confirm boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 if not exists(select 1 from public.expenses where id=p_id and tuki_private.is_member(group_id)) then raise exception 'expense_forbidden' using errcode='42501';end if;
 perform tuki_private.assert_expense_unsettled(p_id);
 perform tuki_private.void_expense_phase4(p_id,p_expected_version,p_confirm);
end; $$;
revoke all on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_void_expense(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_void_expense(uuid,integer,boolean) to authenticated;
alter function public.tuki_expense_detail(uuid) set schema tuki_private;
alter function tuki_private.tuki_expense_detail(uuid) rename to expense_detail_phase4;
revoke all on function tuki_private.expense_detail_phase4(uuid) from public,anon,authenticated;
create function public.tuki_expense_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; locked boolean;
begin
 result:=tuki_private.expense_detail_phase4(p_id);
 select exists(select 1 from public.obligations o join public.payments p on p.status='confirmed' and ((p.payer_id=o.debtor_id and p.receiver_id=o.creditor_id) or (p.payer_id=o.creditor_id and p.receiver_id=o.debtor_id)) where o.expense_id=p_id) into locked;
 return result||jsonb_build_object('payment_locked',locked,'can_edit',(result->>'can_edit')::boolean and not locked);
end; $$;
revoke all on function public.tuki_expense_detail(uuid) from public,anon,authenticated;
grant execute on function public.tuki_expense_detail(uuid) to authenticated;

-- Preserve known lifecycle rules and reject foreign domain references as before.
create or replace function tuki_private.removal_schema_known() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions','receipt_scan_requests','payments','payment_allocations','payment_events'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass) and n.nspname<>'public')
$$;
alter function public.tuki_remove_member(uuid,uuid,boolean) set schema tuki_private;
alter function tuki_private.tuki_remove_member(uuid,uuid,boolean) rename to remove_member_phase4;
revoke all on function tuki_private.remove_member_phase4(uuid,uuid,boolean) from public,anon,authenticated;
create function public.tuki_remove_member(p_group_id uuid,p_person_id uuid,p_confirm boolean) returns text language plpgsql security definer set search_path='' as $$
declare target public.group_members;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 if p_confirm is distinct from true then raise exception 'confirmation_required';end if;
 perform tuki_private.lock_admin(p_group_id);
 if exists(select 1 from public.payments where group_id=p_group_id and p_person_id in(payer_id,receiver_id)) then
  select * into target from public.group_members where group_id=p_group_id and person_id=p_person_id for update;
  if not found then raise exception 'person_forbidden' using errcode='42501';end if;
  if target.role='admin' and target.status='active' and (select count(*) from public.group_members where group_id=p_group_id and role='admin' and status='active')<=1 then raise exception 'last_admin';end if;
  if target.status<>'retired' then
   update public.group_members set status='retired',retired_at=clock_timestamp(),updated_at=clock_timestamp() where group_id=p_group_id and person_id=p_person_id;
   perform tuki_private.event(p_group_id,'member_changed',p_person_id,jsonb_build_object('role_before',target.role,'role_after',target.role,'status_before',target.status,'status_after','retired'));
  end if;return 'retired';
 end if;
 return tuki_private.remove_member_phase4(p_group_id,p_person_id,p_confirm);
end; $$;
revoke all on function public.tuki_remove_member(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_remove_member(uuid,uuid,boolean) to authenticated;

-- Minimal obligation references for choosing FIFO or explicit assignments. No
-- expense IDs, titles, notes, original currencies, products or private receipts.
create function public.tuki_payment_workspace(p_group_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; obligations jsonb; payments jsonb; options jsonb; historical boolean:=false;
begin
 actor:=public.tuki_ensure_person();
 if p_group_id is not null and not tuki_private.is_member(p_group_id) then
  if not exists(select 1 from public.group_members where group_id=p_group_id and person_id=actor and replaced_by_person_id is null) then raise exception 'group_forbidden' using errcode='42501';end if;
  historical:=true;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',o.id,'debtor_id',o.debtor_id,'creditor_id',o.creditor_id,'debtor_name',d.display_name,'creditor_name',c.display_name,'amount_minor',o.remaining_minor::text,'origin_group_id',o.group_id,'origin_group_name',g.name)),'[]') into obligations
 from tuki_private.open_obligations o join public.groups g on g.id=o.group_id join public.persons d on d.id=o.debtor_id join public.persons c on c.id=o.creditor_id join public.expenses e on e.id=o.expense_id
 where o.active and o.remaining_minor>0 and ((p_group_id is null and actor in(o.debtor_id,o.creditor_id)) or (historical and o.group_id=p_group_id and actor in(o.debtor_id,o.creditor_id)) or (p_group_id is not null and not historical and ((o.group_id=p_group_id and tuki_private.is_admin(p_group_id)) or (exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=o.debtor_id and m.status='active') and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=o.creditor_id and m.status='active')))));
 -- Ordinary group viewers get projections, not a new ability to create payments
 -- for other people. Include only pairs the caller can actually register.
 select coalesce(jsonb_agg(row),'[]') into options from (
  select d.id as payer_id,c.id as receiver_id,d.display_name as payer_name,c.display_name as receiver_name,
   case when actor in(d.id,c.id) and c.user_id is not null and d.user_id is not null then 'global' else 'group' end as scope,
   greatest(0,case when actor in(d.id,c.id) and c.user_id is not null and d.user_id is not null then tuki_private.pair_balance(d.id,c.id,null) when actor in(d.id,c.id) then least(tuki_private.pair_balance(d.id,c.id,null),tuki_private.pair_balance(d.id,c.id,p_group_id)) else tuki_private.pair_balance(d.id,c.id,p_group_id) end)::text as max_minor
  from (select distinct debtor_id,creditor_id from tuki_private.open_obligations where active and remaining_minor>0) pairs join public.persons d on d.id=pairs.debtor_id join public.persons c on c.id=pairs.creditor_id where d.id<>c.id and d.merged_into is null and c.merged_into is null
   and exists(select 1 from tuki_private.open_obligations o where o.active and o.remaining_minor>0 and o.debtor_id=d.id and o.creditor_id=c.id)
   and ((p_group_id is null and actor in(d.id,c.id) and d.user_id is not null and c.user_id is not null)
    or(p_group_id is not null and (actor in(d.id,c.id) or tuki_private.is_admin(p_group_id))
     and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=d.id and m.replaced_by_person_id is null)
     and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=c.id and m.replaced_by_person_id is null)))
 ) row where row.max_minor::numeric>0;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'payer_id',p.payer_id,'receiver_id',p.receiver_id,'payer_name',d.display_name,'receiver_name',c.display_name,
  'amount_minor',p.amount_minor::text,'date',p.payment_date,'method',p.method,'status',p.status,'version',p.version,'note',p.note,'reference',p.reference,'group_id',p.group_id,'group_name',context_group.name,'scope',p.scope,
  'created_by',p.created_by,'creator_name',creator.display_name,'confirmed_by',p.confirmed_by,'confirmer_name',confirmer.display_name,'approval_mode',p.approval_mode,'receipt',p.receipt_data is not null,
  'can_approve',p.status='pending' and actor<>p.created_by and (actor=p.approver_id or (p.scope='group' and tuki_private.is_admin(p.group_id) and actor not in(p.payer_id,p.receiver_id) and exists(select 1 from public.persons where id=p.approver_id and user_id is null))),
  'can_void',case when p.status='pending' then actor=p.created_by or actor=p.approver_id else p.status='confirmed' and ((p.approval_mode='counterparty' and actor=p.confirmed_by) or (p.approval_mode='administrative' and tuki_private.is_admin(p.group_id) and actor<>p.created_by and actor not in(p.payer_id,p.receiver_id))) end,
  'allocations',coalesce((select jsonb_agg(jsonb_build_object('obligation_id',a.obligation_id,'amount_minor',a.amount_minor::text,'origin_group_name',g.name,'reversed',a.reversed_at is not null)) from public.payment_allocations a join public.obligations o on o.id=a.obligation_id join public.groups g on g.id=o.group_id where a.payment_id=p.id),'[]'),
  'events',coalesce((select jsonb_agg(jsonb_build_object('action',v.action,'actor_name',person.display_name,'reason',v.reason,'administrative',v.administrative,'created_at',v.created_at) order by v.created_at,v.id) from public.payment_events v join public.persons person on person.id=v.actor_id where v.payment_id=p.id),'[]')) order by p.created_at desc),'[]') into payments
 from public.payments p join public.persons d on d.id=p.payer_id join public.persons c on c.id=p.receiver_id join public.persons creator on creator.id=p.created_by left join public.persons confirmer on confirmer.id=p.confirmed_by left join public.groups context_group on context_group.id=p.group_id
 where tuki_private.can_view_payment(p.id) and (p_group_id is null or p.group_id=p_group_id or exists(select 1 from public.payment_allocations a join public.obligations o on o.id=a.obligation_id where a.payment_id=p.id and o.group_id=p_group_id));
 return jsonb_build_object('person_id',actor,'obligations',obligations,'options',options,'payments',payments);
end; $$;
revoke all on function public.tuki_payment_workspace(uuid) from public,anon,authenticated;
grant execute on function public.tuki_payment_workspace(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
