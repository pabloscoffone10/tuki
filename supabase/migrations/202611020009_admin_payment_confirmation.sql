-- Intentional policy revision after Phase 6. Apply once after 001-008.
begin;
do $$ declare c record;begin
 if pg_catalog.to_regclass('public.notifications') is null then raise exception 'phase6_required';end if;
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.payments'::regclass and contype='c' and pg_catalog.pg_get_constraintdef(oid) ~ 'created_by\s*<>\s*approver_id' loop
  execute format('alter table public.payments drop constraint %I',c.conname);
 end loop;
end $$;
-- Already confirmed/rejected/void records retain their original authority.
-- Only the designated approver of outstanding requests changes to the receiver.
update public.payments set approver_id=receiver_id where status='pending';
alter table public.payments add column administrative_reason text;
alter table public.payments add constraint administrative_reason_length check(administrative_reason is null or char_length(btrim(administrative_reason)) between 8 and 500);

create function tuki_private.guest_payment(payer uuid,receiver uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.persons where id in(payer,receiver) and user_id is null and merged_into is null)
$$;
create function tuki_private.can_admin_payment(payer uuid,receiver uuid,g uuid) returns boolean language sql stable security definer set search_path='' as $$
 select g is not null and tuki_private.is_admin(g) and tuki_private.guest_payment(payer,receiver)
 and exists(select 1 from public.group_members where group_id=g and person_id=payer and replaced_by_person_id is null)
 and exists(select 1 from public.group_members where group_id=g and person_id=receiver and replaced_by_person_id is null)
$$;
revoke all on function tuki_private.guest_payment(uuid,uuid),tuki_private.can_admin_payment(uuid,uuid,uuid) from public,anon,authenticated;

-- The caller has already acquired finance_gate; this helper uses the very same
-- Phase 5 plan, allocations, status and event ledger for all confirmation modes.
create function tuki_private.confirm_payment(p public.payments,actor uuid,mode text,reason text,event_id uuid,digest text) returns void
language plpgsql set search_path='' as $$
declare part jsonb;
begin
 for part in select * from jsonb_array_elements(tuki_private.payment_plan(p.payer_id,p.receiver_id,case when p.scope='group' or mode='administrative' then p.group_id else null end,p.selected_obligations,p.amount_minor)) loop
  insert into public.payment_allocations(payment_id,obligation_id,amount_minor,actor_id) values(p.id,(part->>'id')::uuid,(part->>'amount')::numeric,actor);
 end loop;
 update public.payments set status='confirmed',version=version+1,confirmed_by=actor,confirmed_at=clock_timestamp(),approval_mode=mode,
  receiver_attested=(mode='receiver_receipt'),administrative_reason=case when mode='administrative' then reason else null end where id=p.id;
 insert into public.payment_events(id,payment_id,actor_id,action,from_status,to_status,reason,administrative,request_hash)
 values(event_id,p.id,actor,'confirm','pending','confirmed',reason,mode='administrative',digest);
end; $$;
revoke all on function tuki_private.confirm_payment(public.payments,uuid,text,text,uuid,text) from public,anon,authenticated;

create or replace function tuki_private.create_payment_phase5(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid
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
 approver:=receiver;
 if p_data->>'administrative'='true' then payment_scope:='group';end if;
 -- A guest cannot authorize a global settlement. Administrative attestation is
 -- restricted to this origin, even if the creator is a registered counterparty.
 if (p_data->>'received') is distinct from 'true' and exists(select 1 from public.persons where id=approver and user_id is null) then
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



create or replace function public.tuki_create_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; g uuid; payer uuid; receiver uuid; result uuid; p public.payments; administrative boolean; received boolean; reason text;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 payer:=(p_data->>'payerId')::uuid;receiver:=(p_data->>'receiverId')::uuid;g:=(p_data->>'groupId')::uuid;
 if (p_data ? 'received' and jsonb_typeof(p_data->'received') is distinct from 'boolean') or(p_data ? 'administrative' and jsonb_typeof(p_data->'administrative') is distinct from 'boolean') then raise exception 'payment_forbidden';end if;
 received:=coalesce((p_data->>'received')::boolean,false);administrative:=coalesce((p_data->>'administrative')::boolean,false);reason:=coalesce(p_data->>'administrativeReason','');
 if received and actor is distinct from receiver then raise exception 'payment_forbidden' using errcode='42501';end if;
 if received and administrative then raise exception 'payment_confirmation_mode';end if;
 if g is not null then perform id from public.groups where id=g for update;end if;
 if administrative then
  if not tuki_private.can_admin_payment(payer,receiver,g) then raise exception 'payment_admin_not_allowed' using errcode='42501';end if;
  if jsonb_typeof(p_data->'administrativeReason') is distinct from 'string' or char_length(btrim(reason)) not between 8 and 500 then raise exception 'payment_reason_required';end if;
 end if;
 result:=tuki_private.create_payment_phase5(p_id,p_data,p_confirm);
 select * into p from public.payments where id=result for update;
 if p.status='pending' then
  if administrative then perform tuki_private.confirm_payment(p,actor,'administrative',reason,gen_random_uuid(),p.request_hash);
  elsif received then perform tuki_private.confirm_payment(p,actor,'receiver_receipt','Recepción declarada por el receptor autorizado',gen_random_uuid(),p.request_hash);end if;
 end if;return result;
end; $$;

create or replace function public.tuki_transition_payment(p_id uuid,p_version integer,p_action text,p_reason text,p_request_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.payments; previous public.payment_events; digest text; administrative boolean; receiver_allowed boolean; mode text; target text;
begin
 actor:=public.tuki_ensure_person();if p_confirm is distinct from true then raise exception 'confirmation_required';end if;
 if p_action is null or p_action not in('confirm','reject','void') or p_reason is null or char_length(p_reason)>500 or(p_action in('reject','void') and char_length(btrim(p_reason))<8) then raise exception 'payment_reason_required';end if;
 perform tuki_private.lock_finance();digest:=encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_action,p_reason)::text,'UTF8')),'hex');
 select * into previous from public.payment_events where id=p_request_id;
 if found then if previous.actor_id=actor and previous.request_hash=digest then return;else raise exception 'payment_idempotency_conflict';end if;end if;
 select * into p from public.payments where id=p_id for update;
 if not found or not tuki_private.can_view_payment(p_id) then raise exception 'payment_forbidden' using errcode='42501';end if;
 if p.group_id is not null then perform id from public.groups where id=p.group_id for update;end if;
 if p.version is distinct from p_version then raise exception 'payment_conflict';end if;
 administrative:=p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id);
 receiver_allowed:=actor=p.receiver_id;
 if p.status='pending' then
  if p_action='confirm' then
   if not receiver_allowed and not administrative then raise exception 'payment_receiver_required' using errcode='42501';end if;
   mode:=case when receiver_allowed then case when actor=p.created_by then 'receiver_receipt' else 'counterparty' end else 'administrative' end;
   if mode='administrative' and char_length(btrim(p_reason))<8 then raise exception 'payment_reason_required';end if;
   perform tuki_private.confirm_payment(p,actor,mode,p_reason,p_request_id,digest);return;
  elsif p_action='reject' then
   if not receiver_allowed and not administrative then raise exception 'payment_receiver_required' using errcode='42501';end if;target:='rejected';
  else
   if actor<>p.created_by and not receiver_allowed and not administrative then raise exception 'payment_forbidden' using errcode='42501';end if;target:='void';
  end if;
 elsif p.status='confirmed' and p_action='void' then
  if not((p.approval_mode in('counterparty','receiver_receipt') and actor=p.confirmed_by) or(p.approval_mode='administrative' and administrative)) then raise exception 'payment_forbidden' using errcode='42501';end if;
  update public.payment_allocations set reversed_at=clock_timestamp(),reversed_by=actor where payment_id=p.id and reversed_at is null;target:='void';
 else raise exception 'payment_conflict';end if;
 update public.payments set status=target,version=version+1 where id=p.id;
 insert into public.payment_events(id,payment_id,actor_id,action,from_status,to_status,reason,administrative,request_hash) values(p_request_id,p.id,actor,p_action,p.status,target,p_reason,administrative and not receiver_allowed,digest);
end; $$;
revoke all on function public.tuki_create_payment(uuid,jsonb,boolean),public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_create_payment(uuid,jsonb,boolean),public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) to authenticated;

-- Preserve the existing projections and attach current authority to each option.
alter function public.tuki_payment_workspace(uuid) set schema tuki_private;
alter function tuki_private.tuki_payment_workspace(uuid) rename to payment_workspace_phase6;
revoke all on function tuki_private.payment_workspace_phase6(uuid) from public,anon,authenticated;
create function public.tuki_payment_workspace(p_group_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; actor uuid;
begin
 result:=tuki_private.payment_workspace_phase6(p_group_id);actor:=tuki_private.current_person();
 result:=result||jsonb_build_object('admin_confirmation_policy',true);
 result:=jsonb_set(result,'{options}',coalesce((select jsonb_agg(x||jsonb_build_object('can_admin_confirm',tuki_private.can_admin_payment((x->>'payer_id')::uuid,(x->>'receiver_id')::uuid,p_group_id),
  'max_minor',case when tuki_private.can_admin_payment((x->>'payer_id')::uuid,(x->>'receiver_id')::uuid,p_group_id) then greatest(0,least(tuki_private.pair_balance((x->>'payer_id')::uuid,(x->>'receiver_id')::uuid,p_group_id),(x->>'max_minor')::numeric))::text else x->>'max_minor' end)) from jsonb_array_elements(result->'options') x),'[]'));
 result:=jsonb_set(result,'{options}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'options') x where (x->>'max_minor')::numeric>0),'[]'));
 return jsonb_set(result,'{payments}',coalesce((select jsonb_agg(x||jsonb_build_object(
  'can_admin_confirm',p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id),
  'confirm_as_admin',actor<>p.receiver_id and p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id),
  'receiver_name',receiver.display_name,'administrative_reason',p.administrative_reason,
  'can_approve',p.status='pending' and(actor=p.receiver_id or(p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id))),
  'can_void',case when p.status='pending' then actor=p.created_by or actor=p.receiver_id or(p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id)) else p.status='confirmed' and((p.approval_mode in('counterparty','receiver_receipt') and actor=p.confirmed_by) or(p.approval_mode='administrative' and p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id))) end))
 from jsonb_array_elements(result->'payments') x join public.payments p on p.id=(x->>'id')::uuid join public.persons receiver on receiver.id=p.receiver_id),'[]'));
end; $$;
revoke all on function public.tuki_payment_workspace(uuid) from public,anon,authenticated;
grant execute on function public.tuki_payment_workspace(uuid) to authenticated;

-- New payment requests always target the registered receiver; guest requests
-- are offered to current origin administrators, including their creator.
create or replace function tuki_private.payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payments; recipient record; heading text; message text; receiver_account uuid;
begin
 select * into p from public.payments where id=new.payment_id;
 select user_id into receiver_account from public.persons where id=p.receiver_id;
 if new.action='created' then
  heading:='¿Recibiste el dinero?';select display_name||' registró un pago de $ '||replace(round(p.amount_minor/100,2)::text,'.',',')||' UYU. ¿Recibiste el dinero?' into message from public.persons where id=p.payer_id;
  for recipient in select receiver_account as user_id where receiver_account is not null
   union select x.user_id from public.group_members m join public.persons x on x.id=m.person_id where m.group_id=p.group_id and m.status='active' and m.role='admin' and p.scope='group' and tuki_private.guest_payment(p.payer_id,p.receiver_id) and x.user_id is not null
  loop perform tuki_private.queue_notification(recipient.user_id,'payment:'||new.id,'payments','confirmation_requested',heading,message,'/pagos',p.id);end loop;
 else
  heading:=case new.action when 'confirm' then case when new.administrative then 'Pago confirmado por administrador' else 'Pago confirmado por el receptor' end when 'reject' then 'Pago rechazado' else 'Pago anulado' end;
  for recipient in select distinct user_id from public.persons where id in(p.payer_id,p.receiver_id,p.created_by) and user_id is not null
  loop perform tuki_private.queue_notification(recipient.user_id,'payment:'||new.id,'payments','payment_'||case new.action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'voided' end,heading,'Consultá quién realizó la declaración, su motivo y el historial del pago.','/pagos',p.id);end loop;
  if new.action='confirm' and tuki_private.pair_balance(p.payer_id,p.receiver_id,null)=0 then
   for recipient in select user_id from public.persons where id in(p.payer_id,p.receiver_id) and user_id is not null
   loop perform tuki_private.queue_notification(recipient.user_id,'settled:'||new.id,'payments','debt_settled','Deuda saldada','El saldo neto de este par quedó en cero.','/pagos',p.id);end loop;
  end if;
 end if;return new;
end; $$;
revoke all on function tuki_private.payment_notifications() from public,anon,authenticated;

-- Address outstanding pre-policy requests to their current receiver/admins.
do $$ declare p public.payments; r record;begin
 for p in select * from public.payments where status='pending' loop
  for r in select user_id from public.persons where id=p.receiver_id and user_id is not null
   union select person.user_id from public.group_members m join public.persons person on person.id=m.person_id where p.scope='group' and m.group_id=p.group_id and m.status='active' and m.role='admin' and tuki_private.guest_payment(p.payer_id,p.receiver_id) and person.user_id is not null
  loop if not exists(select 1 from tuki_private.notification_outbox where user_id=r.user_id and payment_id=p.id and kind='confirmation_requested') then perform tuki_private.queue_notification(r.user_id,'policy9:'||p.id,'payments','confirmation_requested','Pago pendiente de recepción','Hay un pago pendiente. Revisá si recibiste el dinero o si corresponde tu confirmación administrativa.','/pagos',p.id);end if;end loop;
 end loop;
end $$;

alter function public.tuki_notification_inbox() set schema tuki_private;
alter function tuki_private.tuki_notification_inbox() rename to notification_inbox_phase6;
revoke all on function tuki_private.notification_inbox_phase6() from public,anon,authenticated;
create function public.tuki_notification_inbox() returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; actor uuid;
begin
 result:=tuki_private.notification_inbox_phase6();actor:=tuki_private.current_person();
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(x||case when p.id is not null and p.status='pending' and tuki_private.can_view_payment(p.id) then jsonb_build_object(
  'payment_id',p.id,'payment_version',p.version,'can_confirm',actor=p.receiver_id or(p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id)),
  'confirm_as_admin',actor<>p.receiver_id and p.scope='group' and tuki_private.can_admin_payment(p.payer_id,p.receiver_id,p.group_id)) else jsonb_build_object('can_confirm',false) end)
 from jsonb_array_elements(result->'items') x join public.notifications n on n.id=(x->>'id')::uuid
 left join tuki_private.notification_outbox o on o.user_id=n.user_id and o.event_key=n.event_key left join public.payments p on p.id=o.payment_id),'[]'));
end; $$;
revoke all on function public.tuki_notification_inbox() from public,anon,authenticated;
grant execute on function public.tuki_notification_inbox() to authenticated;

notify pgrst,'reload schema';
commit;
