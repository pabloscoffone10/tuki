-- Block 1: durable payment attempts and authoritative, scoped pair states.
-- Apply once after 009. No existing financial amounts or balances are changed.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='administrative_reason') then raise exception 'phase9_required';end if;
end $$;

-- Payloads, receipts and request digests never enter browser persistence or
-- public tables. The application only needs an opaque operation ID to recover.
create table tuki_private.payment_operations (
 id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,
 payload jsonb,request_hash text not null,state text not null default 'prepared' check(state in('prepared','processed','rejected','cancelled')),
 error_code text,created_at timestamptz not null default clock_timestamp(),acknowledged_at timestamptz,
 check(payload is null or octet_length(payload::text)<=1048576)
);
create unique index payment_operation_unacknowledged on tuki_private.payment_operations(user_id) where acknowledged_at is null;
revoke all on tuki_private.payment_operations from public,anon,authenticated;

create function tuki_private.operation_result(operation tuki_private.payment_operations) returns jsonb
language sql stable set search_path='' as $$
 select jsonb_build_object('id',operation.id,'state',case when p.id is not null then 'processed' else operation.state end,
 'payment_status',p.status,'version',p.version,'error_code',operation.error_code,'created_at',operation.created_at,
 'summary',case when operation.payload is not null then jsonb_build_object(
  'payer_name',case when tuki_private.can_view_person((operation.payload->>'payerId')::uuid) or tuki_private.current_person() in((operation.payload->>'payerId')::uuid,(operation.payload->>'receiverId')::uuid) and exists(select 1 from public.obligations o where(o.debtor_id=(operation.payload->>'payerId')::uuid and o.creditor_id=(operation.payload->>'receiverId')::uuid)or(o.creditor_id=(operation.payload->>'payerId')::uuid and o.debtor_id=(operation.payload->>'receiverId')::uuid)) then d.display_name else 'Participante' end,
  'receiver_name',case when tuki_private.can_view_person((operation.payload->>'receiverId')::uuid) or tuki_private.current_person() in((operation.payload->>'payerId')::uuid,(operation.payload->>'receiverId')::uuid) and exists(select 1 from public.obligations o where(o.debtor_id=(operation.payload->>'payerId')::uuid and o.creditor_id=(operation.payload->>'receiverId')::uuid)or(o.creditor_id=(operation.payload->>'payerId')::uuid and o.debtor_id=(operation.payload->>'receiverId')::uuid)) then c.display_name else 'Participante' end,
  'amount',operation.payload->>'amount','date',operation.payload->>'date','method',operation.payload->>'method',
  'group_name',case when tuki_private.is_member((operation.payload->>'groupId')::uuid) or exists(select 1 from public.group_members m where m.group_id=(operation.payload->>'groupId')::uuid and m.person_id=tuki_private.current_person()) then g.name else null end,
  'administrative',coalesce(operation.payload->'administrative','false'::jsonb),'received',coalesce(operation.payload->'received','false'::jsonb),'reason',operation.payload->>'administrativeReason') else null end)
 from (select 1) seed left join public.payments p on p.id=operation.id
 left join public.persons d on d.id=(operation.payload->>'payerId')::uuid
 left join public.persons c on c.id=(operation.payload->>'receiverId')::uuid
 left join public.groups g on g.id=(operation.payload->>'groupId')::uuid
$$;
revoke all on function tuki_private.operation_result(tuki_private.payment_operations) from public,anon,authenticated;

create function public.tuki_current_payment_operation() returns jsonb language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 -- Wait for an in-flight commit before calling an attempt unsent or absent.
 select * into operation from tuki_private.payment_operations where user_id=auth.uid() and acknowledged_at is null;
 if not found then return null;end if;
 return tuki_private.operation_result(operation);
end; $$;
create function public.tuki_payment_operation(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;actor uuid;payment public.payments;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into operation from tuki_private.payment_operations where id=p_id and user_id=auth.uid();
 if found then return tuki_private.operation_result(operation);end if;
 -- Recover legacy requests made before this migration, but only their creator.
 select * into payment from public.payments where id=p_id and created_by=actor;
 if not found then return null;end if;
 return jsonb_build_object('id',payment.id,'state','processed','payment_status',payment.status,'version',payment.version,'created_at',payment.created_at);
end; $$;

create function public.tuki_prepare_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;existing tuki_private.payment_operations;actor uuid;digest text;payment public.payments;
begin
 actor:=public.tuki_ensure_person();if p_confirm is distinct from true then raise exception 'confirmation_required';end if;
 if p_id is null or jsonb_typeof(p_data) is distinct from 'object' or octet_length(p_data::text)>1048576 then raise exception 'invalid_input';end if;
 if(p_data->>'payerId')::uuid is null or(p_data->>'receiverId')::uuid is null then raise exception 'payment_invalid_parties';end if;
 perform tuki_private.lock_finance();digest:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 select * into operation from tuki_private.payment_operations where id=p_id for update;
 if found then
  if operation.user_id<>auth.uid() or operation.request_hash<>digest then raise exception 'payment_idempotency_conflict';end if;
  if operation.state='cancelled' then raise exception 'operation_cancelled';end if;
  return tuki_private.operation_result(operation);
 end if;
 select * into existing from tuki_private.payment_operations where user_id=auth.uid() and acknowledged_at is null for update;
 if found then raise exception 'operation_unresolved';end if;
 select * into payment from public.payments where id=p_id;
 if found and(payment.created_by<>actor or payment.request_hash<>digest) then raise exception 'payment_idempotency_conflict';end if;
 insert into tuki_private.payment_operations(id,user_id,payload,request_hash,state)
 values(p_id,auth.uid(),p_data,digest,case when payment.id is null then 'prepared' else 'processed' end) returning * into operation;
 return tuki_private.operation_result(operation);
end; $$;

-- Keep the audited engine and its row locks, amount rules, authorization,
-- allocation strategy, receipts, idempotency hashes and event/notification ledger.
alter function public.tuki_create_payment(uuid,jsonb,boolean) set schema tuki_private;
alter function tuki_private.tuki_create_payment(uuid,jsonb,boolean) rename to create_payment_phase9;
revoke all on function tuki_private.create_payment_phase9(uuid,jsonb,boolean) from public,anon,authenticated;

create function public.tuki_submit_prepared_payment(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;safe_code text;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into operation from tuki_private.payment_operations where id=p_id and user_id=auth.uid() for update;
 if not found or operation.state='cancelled' then raise exception 'operation_unavailable' using errcode='42501';end if;
 if operation.state in('processed','rejected') then return tuki_private.operation_result(operation);end if;
 if operation.acknowledged_at is not null then raise exception 'operation_unavailable' using errcode='42501';end if;
 begin
  perform tuki_private.create_payment_phase9(operation.id,operation.payload,true);
  update tuki_private.payment_operations set state='processed',error_code=null where id=p_id;
 exception when others then
  -- A subtransaction rolls back ALL financial changes before persisting a
  -- definitive safe rejection. Unknown infrastructure failures are rethrown;
  -- callers must reconcile the same ID, never create a replacement blindly.
  safe_code:=sqlerrm;
  if safe_code in('payment_forbidden','payment_admin_not_allowed','payment_confirmation_mode','payment_invalid_parties','payment_over_amount','payment_not_assignable','payment_selection_changed','payment_reason_required','payment_guest_origin_required','invalid_decimal','invalid_receipt','payment_idempotency_conflict','group_forbidden','authentication_required') or sqlstate in('22003','22007','22P02','23502','23514') then
   if safe_code not in('payment_forbidden','payment_admin_not_allowed','payment_confirmation_mode','payment_invalid_parties','payment_over_amount','payment_not_assignable','payment_selection_changed','payment_reason_required','payment_guest_origin_required','invalid_decimal','invalid_receipt','payment_idempotency_conflict','group_forbidden','authentication_required') then safe_code:='invalid_input';end if;
   update tuki_private.payment_operations set state='rejected',error_code=safe_code where id=p_id;
  else raise;end if;
 end;
 select * into operation from tuki_private.payment_operations where id=p_id;
 return tuki_private.operation_result(operation);
end; $$;

create function public.tuki_ack_payment_operation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into operation from tuki_private.payment_operations where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'operation_unavailable' using errcode='42501';end if;
 if operation.state not in('processed','rejected') then raise exception 'operation_unresolved';end if;
 update tuki_private.payment_operations set acknowledged_at=coalesce(acknowledged_at,clock_timestamp()),payload=null where id=p_id;
end; $$;
create function public.tuki_cancel_payment_operation(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into operation from tuki_private.payment_operations where id=p_id and user_id=auth.uid() for update;
 if not found then raise exception 'operation_unavailable' using errcode='42501';end if;
 if operation.state='cancelled' then return;end if;
 if operation.state<>'prepared' or exists(select 1 from public.payments where id=p_id) then raise exception 'operation_unresolved';end if;
 update tuki_private.payment_operations set state='cancelled',payload=null,acknowledged_at=clock_timestamp() where id=p_id;
end; $$;

-- Legacy entry point cannot bypass the durable operation gate. A new payment
-- needs explicit acknowledgment of the previous result, not a new random UUID.
create function public.tuki_create_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public.tuki_prepare_payment(p_id,p_data,p_confirm);
 result:=public.tuki_submit_prepared_payment(p_id);
 if result->>'state'='rejected' then raise exception '%',result->>'error_code';end if;
 return p_id;
end; $$;
revoke all on function public.tuki_current_payment_operation(),public.tuki_payment_operation(uuid),public.tuki_prepare_payment(uuid,jsonb,boolean),public.tuki_submit_prepared_payment(uuid),public.tuki_ack_payment_operation(uuid),public.tuki_cancel_payment_operation(uuid),public.tuki_create_payment(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tuki_current_payment_operation(),public.tuki_payment_operation(uuid),public.tuki_prepare_payment(uuid,jsonb,boolean),public.tuki_submit_prepared_payment(uuid),public.tuki_ack_payment_operation(uuid),public.tuki_cancel_payment_operation(uuid),public.tuki_create_payment(uuid,jsonb,boolean) to authenticated;

-- A scoped state explicitly reads the ledger, including zero-remaining active
-- obligations. Missing authorization/evidence is never treated as a zero debt.
create function tuki_private.pair_state(payer uuid,receiver uuid,g uuid,actor uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare allowed boolean;origin uuid;scope text;balance numeric;paid numeric;counted bigint;pending boolean;name_payer text;name_receiver text;state text;out_payer uuid:=payer;out_receiver uuid:=receiver;
begin
 allowed:=actor in(payer,receiver) or(g is not null and tuki_private.is_member(g)
  and exists(select 1 from public.group_members where group_id=g and person_id=payer and status='active')
  and exists(select 1 from public.group_members where group_id=g and person_id=receiver and status='active'));
 if allowed then scope:='global';origin:=null;
 elsif g is not null and tuki_private.is_admin(g) then scope:='group';origin:=g;
 else scope:='unverifiable';end if;
 select display_name into name_payer from public.persons where id=payer;
 select display_name into name_receiver from public.persons where id=receiver;
 select exists(select 1 from public.payments p where p.status='pending' and tuki_private.can_view_payment(p.id)
  and((p.payer_id=payer and p.receiver_id=receiver)or(p.payer_id=receiver and p.receiver_id=payer)) and(g is null or p.group_id=g or exists(select 1 from public.payment_allocations a join public.obligations o on o.id=a.obligation_id where a.payment_id=p.id and o.group_id=g))) into pending;
 if scope<>'unverifiable' then
  select count(*),coalesce(sum(case when o.debtor_id=payer then o.remaining_minor else -o.remaining_minor end),0),coalesce(sum(o.amount_minor-o.remaining_minor),0)
  into counted,balance,paid from tuki_private.open_obligations o where o.active
   and((o.debtor_id=payer and o.creditor_id=receiver)or(o.debtor_id=receiver and o.creditor_id=payer)) and(origin is null or o.group_id=origin);
  if counted=0 then scope:='unverifiable';else
   state:=case when balance=0 then 'settled' when paid>0 then 'partial' else 'pending' end;
   if balance<0 then out_payer:=receiver;out_receiver:=payer;end if;
  end if;
 end if;
 if scope='unverifiable' then state:='unverifiable';balance:=null;end if;
 return jsonb_build_object('payer_id',out_payer,'receiver_id',out_receiver,'payer_name',case when out_payer=payer then name_payer else name_receiver end,'receiver_name',case when out_receiver=receiver then name_receiver else name_payer end,
 'state',state,'remaining_minor',case when balance is null then null else abs(balance)::text end,'pending_payment',pending,'scope',scope);
end; $$;
revoke all on function tuki_private.pair_state(uuid,uuid,uuid,uuid) from public,anon,authenticated;

alter function public.tuki_payment_workspace(uuid) set schema tuki_private;
alter function tuki_private.tuki_payment_workspace(uuid) rename to payment_workspace_phase9;
revoke all on function tuki_private.payment_workspace_phase9(uuid) from public,anon,authenticated;
create function public.tuki_payment_workspace(p_group_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;states jsonb;actor uuid;
begin
 result:=tuki_private.payment_workspace_phase9(p_group_id);actor:=tuki_private.current_person();
 with pairs as(
  select least((x->>'debtor_id')::uuid,(x->>'creditor_id')::uuid) payer,greatest((x->>'debtor_id')::uuid,(x->>'creditor_id')::uuid) receiver from jsonb_array_elements(result->'obligations') x
  union select least((x->>'payer_id')::uuid,(x->>'receiver_id')::uuid),greatest((x->>'payer_id')::uuid,(x->>'receiver_id')::uuid) from jsonb_array_elements(result->'payments') x
 ) select coalesce(jsonb_agg(tuki_private.pair_state(payer,receiver,p_group_id,actor)),'[]') into states from pairs;
 return result||jsonb_build_object('operation_protocol',true,'pair_states',states);
end; $$;
revoke all on function public.tuki_payment_workspace(uuid) from public,anon,authenticated;
grant execute on function public.tuki_payment_workspace(uuid) to authenticated;

-- Keep the conservative edit lock: inverse obligations also participate in
-- netting. Explain the safe reversal route without exposing private payment IDs.
alter function public.tuki_expense_detail(uuid) set schema tuki_private;
alter function tuki_private.tuki_expense_detail(uuid) rename to expense_detail_phase9;
revoke all on function tuki_private.expense_detail_phase9(uuid) from public,anon,authenticated;
create function public.tuki_expense_detail(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=tuki_private.expense_detail_phase9(p_id);
 if(result->>'payment_locked')::boolean then result:=result||jsonb_build_object('payment_lock_reason','confirmed_pair_payments','payment_lock_resolution','Hay pagos confirmados entre participantes de este gasto, incluso en sentido inverso. Sus autorizados deben anularlos con motivo antes de editar o anular el gasto; después podrán registrar los pagos corregidos. El bloqueo no implica que tengas permiso para ver o revertir pagos privados de otro grupo.');end if;
 return result;
end; $$;
revoke all on function public.tuki_expense_detail(uuid) from public,anon,authenticated;
grant execute on function public.tuki_expense_detail(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
