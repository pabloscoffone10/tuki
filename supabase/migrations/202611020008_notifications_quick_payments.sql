-- Phase 6. Apply once after 001-007. Automatic reminders disabled by default.
begin;
do $$ begin if pg_catalog.to_regprocedure('public.tuki_create_payment(uuid,jsonb,boolean)') is null then raise exception 'phase5_required';end if;end $$;
alter table public.payments add column receiver_attested boolean not null default false;
alter table public.payments drop constraint payments_approval_mode_check;
alter table public.payments add constraint payments_approval_mode_check check(approval_mode in('counterparty','administrative','receiver_receipt'));
alter table public.payments add constraint payment_receipt_actor check(not receiver_attested or(created_by=receiver_id and confirmed_by=receiver_id));

create table public.notification_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 payments boolean not null default true, expenses boolean not null default true, groups boolean not null default true,
 reminders boolean not null default true, automatic boolean not null default false, frequency integer not null default 7 check(frequency in(7,14)),updated_at timestamptz not null default clock_timestamp()
);
create table public.notifications (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 event_key text not null, category text not null check(category in('payments','expenses','groups','reminders')),kind text not null,
 title text not null,message text not null,href text not null check(href in('/pagos','/grupos','/gastos') or href~'^/(grupos|gastos)/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' or href~'^/pagos#pago-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'),
 created_at timestamptz not null default clock_timestamp(),read_at timestamptz,unique(user_id,event_key)
);
create index notifications_inbox on public.notifications(user_id,created_at desc);
create table tuki_private.notification_outbox (
 id bigint generated always as identity primary key,user_id uuid not null references auth.users(id) on delete cascade,event_key text not null,
 category text not null,kind text not null,title text not null,message text not null,href text not null,
 payment_id uuid references public.payments(id),expense_id uuid references public.expenses(id),group_id uuid references public.groups(id) on delete cascade,
 debtor_id uuid references public.persons(id),creditor_id uuid references public.persons(id),
 created_at timestamptz not null default clock_timestamp(),delivered_at timestamptz,unique(user_id,event_key)
);
create table tuki_private.reminder_log (
 sender_id uuid not null references public.persons(id),debtor_id uuid not null references public.persons(id),
 last_sent timestamptz not null,primary key(sender_id,debtor_id)
);
create table tuki_private.automatic_reminder_runs (
 user_id uuid not null references auth.users(id) on delete cascade,debtor_id uuid not null references public.persons(id),last_sent timestamptz not null,primary key(user_id,debtor_id)
);
alter table public.notifications enable row level security;
alter table public.notification_preferences enable row level security;
revoke all on public.notifications,public.notification_preferences from public,anon,authenticated;
grant select on public.notifications,public.notification_preferences to authenticated;
create policy notifications_own on public.notifications for select to authenticated using(user_id=(select auth.uid()));
create policy preferences_own on public.notification_preferences for select to authenticated using(user_id=(select auth.uid()));
revoke all on tuki_private.notification_outbox,tuki_private.reminder_log,tuki_private.automatic_reminder_runs from public,anon,authenticated;
revoke all on sequence tuki_private.notification_outbox_id_seq from public,anon,authenticated;

create function tuki_private.queue_notification(recipient uuid,key text,category text,kind text,title text,message text,href text,payment uuid default null,expense uuid default null,g uuid default null,debtor uuid default null,creditor uuid default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if recipient is null then return;end if;
 insert into tuki_private.notification_outbox(user_id,event_key,category,kind,title,message,href,payment_id,expense_id,group_id,debtor_id,creditor_id)
 values(recipient,key,category,kind,title,message,href,payment,expense,g,debtor,creditor) on conflict(user_id,event_key) do nothing;
end; $$;
revoke all on function tuki_private.queue_notification(uuid,text,text,text,text,text,text,uuid,uuid,uuid,uuid,uuid) from public,anon,authenticated;

create function tuki_private.payment_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.payments; recipient record; category_kind text; heading text;
begin
 select * into p from public.payments where id=new.payment_id;
 if new.action='created' then
  for recipient in select distinct x.user_id from public.persons x where x.id=p.approver_id and x.user_id is not null
   union select x.user_id from public.group_members m join public.persons x on x.id=m.person_id where p.scope='group' and m.group_id=p.group_id and m.status='active' and m.role='admin' and m.person_id<>p.created_by and m.person_id not in(p.payer_id,p.receiver_id) and exists(select 1 from public.persons where id=p.approver_id and user_id is null)
  loop perform tuki_private.queue_notification(recipient.user_id,'payment:'||new.id,'payments','confirmation_requested','Pago por confirmar','Hay un pago registrado que requiere tu confirmación.','/pagos',p.id);end loop;
 else
  category_kind:=case new.action when 'confirm' then 'payment_confirmed' when 'reject' then 'payment_rejected' else 'payment_voided' end;
  heading:=case new.action when 'confirm' then 'Pago confirmado' when 'reject' then 'Pago rechazado' else 'Pago anulado' end;
  for recipient in select distinct x.user_id from public.persons x where x.id in(p.payer_id,p.receiver_id,p.created_by) and x.user_id is not null and x.id<>new.actor_id
  loop perform tuki_private.queue_notification(recipient.user_id,'payment:'||new.id,'payments',category_kind,heading,'Consultá el estado y el historial del pago.','/pagos',p.id);end loop;
  if new.action='confirm' and tuki_private.pair_balance(p.payer_id,p.receiver_id,null)=0 then
   for recipient in select distinct user_id from public.persons where id in(p.payer_id,p.receiver_id) and user_id is not null
   loop perform tuki_private.queue_notification(recipient.user_id,'settled:'||new.id,'payments','debt_settled','Deuda saldada','El saldo neto de este par quedó en cero. Consultá el historial.','/pagos',p.id);end loop;
  end if;
 end if;return new;
end; $$;
revoke all on function tuki_private.payment_notifications() from public,anon,authenticated;
create trigger tuki_payment_notifications after insert on public.payment_events for each row execute function tuki_private.payment_notifications();

create function tuki_private.expense_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
 for recipient in select distinct p.user_id from public.expense_people_history h join public.persons p on p.id=h.person_id
  where h.expense_id=new.expense_id and p.user_id is not null and p.id<>new.actor_id and exists(select 1 from public.group_members m where m.group_id=new.group_id and m.person_id=p.id and m.status='active')
 loop perform tuki_private.queue_notification(recipient.user_id,'expense:'||new.id,'expenses','expense_'||new.kind,
  case new.kind when 'created' then 'Nuevo gasto compartido' when 'edited' then 'Gasto modificado' else 'Gasto anulado' end,
  'Hay una actualización en un gasto que te involucra.','/gastos',null,new.expense_id,new.group_id);end loop;
 return new;
end; $$;
revoke all on function tuki_private.expense_notifications() from public,anon,authenticated;
create trigger tuki_expense_notifications after insert on public.expense_events for each row execute function tuki_private.expense_notifications();

create function tuki_private.group_notifications() returns trigger language plpgsql security definer set search_path='' as $$
declare recipient record;
begin
 if new.event_type not in('invitation_accepted','guest_added','person_added','member_changed') then return new;end if;
 for recipient in select distinct p.user_id,p.id from public.group_members m join public.persons p on p.id=m.person_id where m.group_id=new.group_id and (m.status='active' or(new.event_type='member_changed' and m.person_id=new.subject_id and m.status='invited')) and p.user_id is not null and p.id<>new.actor_id
  and ((new.event_type='member_changed' and m.person_id=new.subject_id and new.details->>'status_after'='invited') or (new.event_type='invitation_accepted' and(m.role='admin' or p.id=new.subject_id or exists(select 1 from public.group_invitations i where i.group_id=new.group_id and i.accepted_by=new.subject_id and i.created_by=p.id))) or (new.event_type in('guest_added','person_added') and m.role='admin'))
 loop perform tuki_private.queue_notification(recipient.user_id,'group:'||new.id,'groups',new.event_type,
  case when new.event_type='member_changed' then 'Invitación al grupo' when new.event_type='invitation_accepted' then 'Invitación aceptada' else 'Nuevo participante' end,
  'Consultá la actualización del grupo.','/grupos',null,null,new.group_id);end loop;return new;
end; $$;
revoke all on function tuki_private.group_notifications() from public,anon,authenticated;
create trigger tuki_group_notifications after insert on public.group_events for each row execute function tuki_private.group_notifications();

-- Delivery is separate from financial commits. Snapshot recipients are never
-- inferred from later guest claims. No retroactive backfill of previous phases.
create function public.tuki_notification_inbox() returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; item record; pref public.notification_preferences;
begin
 perform public.tuki_ensure_person();actor:=auth.uid();
 insert into public.notification_preferences(user_id) values(actor) on conflict do nothing;
 select * into pref from public.notification_preferences where user_id=actor;
 for item in select * from tuki_private.notification_outbox where user_id=actor and delivered_at is null order by id limit 100 for update skip locked loop
  if (case item.category when 'payments' then pref.payments when 'expenses' then pref.expenses when 'groups' then pref.groups else pref.reminders end)
   and (item.payment_id is null or tuki_private.can_view_payment(item.payment_id))
   and (item.expense_id is null or exists(select 1 from public.expenses e where e.id=item.expense_id and tuki_private.is_member(e.group_id)))
   and (item.group_id is null or tuki_private.is_member(item.group_id) or item.kind='member_changed')
   and (item.kind<>'confirmation_requested' or exists(select 1 from public.payments p where p.id=item.payment_id and p.status='pending'))
   and (item.kind<>'manual_reminder' or tuki_private.pair_balance(item.debtor_id,item.creditor_id,null)>0)
   and (item.kind<>'automatic_reminder' or(pref.automatic and tuki_private.pair_balance(item.debtor_id,item.creditor_id,null)<>0)) then
   insert into public.notifications(user_id,event_key,category,kind,title,message,href,created_at) values(actor,item.event_key,item.category,item.kind,item.title,item.message,
    case when item.payment_id is not null then '/pagos#pago-'||item.payment_id when item.expense_id is not null then '/gastos/'||item.expense_id when item.group_id is not null and item.kind<>'member_changed' then '/grupos/'||item.group_id else item.href end,item.created_at) on conflict(user_id,event_key) do nothing;
  end if;
  update tuki_private.notification_outbox set delivered_at=clock_timestamp() where id=item.id;
 end loop;
 return jsonb_build_object('unread',(select count(*) from public.notifications where user_id=actor and read_at is null),
 'items',coalesce((select jsonb_agg(row order by row.created_at desc,row.id) from(select id,category,kind,title,message,href,created_at,read_at from public.notifications where user_id=actor order by created_at desc,id limit 100) row),'[]'),
 'preferences',to_jsonb(pref)-'user_id');
end; $$;
create function public.tuki_read_notification(p_id uuid default null) returns void language plpgsql security definer set search_path='' as $$
begin perform public.tuki_ensure_person();update public.notifications set read_at=coalesce(read_at,clock_timestamp()) where user_id=auth.uid() and(p_id is null or id=p_id);end; $$;
create function public.tuki_set_notification_preferences(p_data jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();
 if exists(select 1 from unnest(array['payments','expenses','groups','reminders','automatic']) k where jsonb_typeof(p_data->k) is distinct from 'boolean') or coalesce(p_data->>'frequency','') not in('7','14') then raise exception 'invalid_preferences';end if;
 insert into public.notification_preferences(user_id,payments,expenses,groups,reminders,automatic,frequency) values(auth.uid(),(p_data->>'payments')::boolean,(p_data->>'expenses')::boolean,(p_data->>'groups')::boolean,(p_data->>'reminders')::boolean,(p_data->>'automatic')::boolean,(p_data->>'frequency')::integer)
 on conflict(user_id) do update set payments=excluded.payments,expenses=excluded.expenses,groups=excluded.groups,reminders=excluded.reminders,automatic=excluded.automatic,frequency=excluded.frequency,updated_at=clock_timestamp();
end; $$;
revoke all on function public.tuki_notification_inbox(),public.tuki_read_notification(uuid),public.tuki_set_notification_preferences(jsonb) from public,anon,authenticated;
grant execute on function public.tuki_notification_inbox(),public.tuki_read_notification(uuid),public.tuki_set_notification_preferences(jsonb) to authenticated;

create function public.tuki_remind_debt(p_debtor uuid) returns text language plpgsql security definer set search_path='' as $$
declare actor uuid; amount numeric; target uuid; sender text; last_time timestamptz; message text;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 amount:=tuki_private.pair_balance(p_debtor,actor,null);if amount<=0 or p_debtor=actor then raise exception 'reminder_not_allowed';end if;
 select user_id into target from public.persons where id=p_debtor and merged_into is null;
 select display_name into sender from public.persons where id=actor;
 message:=sender||' te recordó que tenés un saldo pendiente de $ '||replace(round(amount/100,2)::text,'.',',')||' UYU. Revisalo en Tuki.';
 if target is null then return message;end if;
 select last_sent into last_time from tuki_private.reminder_log where sender_id=actor and debtor_id=p_debtor;
 if last_time>clock_timestamp()-interval '1 day' or(select count(*) from tuki_private.reminder_log where sender_id=actor and last_sent>clock_timestamp()-interval '1 day')>=5 then raise exception 'reminder_rate_limit';end if;
 insert into tuki_private.reminder_log values(actor,p_debtor,clock_timestamp()) on conflict(sender_id,debtor_id) do update set last_sent=excluded.last_sent;
 if coalesce((select reminders from public.notification_preferences where user_id=target),true) then
 perform tuki_private.queue_notification(target,'reminder:'||gen_random_uuid(),'reminders','manual_reminder','Recordatorio de pago',message,'/pagos',null,null,null,p_debtor,actor);end if;
 return 'Recordatorio registrado. Se mostrará si la persona tiene habilitados los recordatorios.';
end; $$;
revoke all on function public.tuki_remind_debt(uuid) from public,anon,authenticated;
grant execute on function public.tuki_remind_debt(uuid) to authenticated;

-- Only a server-side service role can request a scheduled run. The deployment
-- endpoint also requires an explicit enable flag and a separate cron secret.
create function public.tuki_run_automatic_reminders() returns integer language plpgsql security definer set search_path='' as $$
declare recipient record; total integer:=0;
begin
 perform tuki_private.lock_finance();
 for recipient in select p.user_id,p.frequency,case when o.debtor_id=person.id then o.creditor_id else o.debtor_id end debtor_id,sum(case when o.creditor_id=person.id then o.remaining_minor else -o.remaining_minor end) amount
 from public.notification_preferences p join public.persons person on person.user_id=p.user_id
 join tuki_private.open_obligations o on person.id in(o.debtor_id,o.creditor_id) and o.active
 where p.automatic and p.reminders and not exists(select 1 from tuki_private.automatic_reminder_runs run where run.user_id=p.user_id and run.debtor_id=case when o.debtor_id=person.id then o.creditor_id else o.debtor_id end and run.last_sent>clock_timestamp()-make_interval(days=>p.frequency)) group by p.user_id,p.frequency,case when o.debtor_id=person.id then o.creditor_id else o.debtor_id end,person.id
 having sum(case when o.creditor_id=person.id then o.remaining_minor else -o.remaining_minor end)<>0 limit 200
 loop
  if exists(select 1 from tuki_private.automatic_reminder_runs where user_id=recipient.user_id and debtor_id=recipient.debtor_id and last_sent>clock_timestamp()-make_interval(days=>recipient.frequency)) then continue;end if;
  perform tuki_private.queue_notification(recipient.user_id,'automatic:'||gen_random_uuid(),'reminders','automatic_reminder','Saldo pendiente','Tenés un saldo pendiente por revisar. Consultá su importe y estado actual en Tuki.','/pagos',null,null,null,recipient.debtor_id,(select id from public.persons where user_id=recipient.user_id and merged_into is null));
  insert into tuki_private.automatic_reminder_runs values(recipient.user_id,recipient.debtor_id,clock_timestamp()) on conflict(user_id,debtor_id) do update set last_sent=excluded.last_sent;
  total:=total+1;
 end loop;return total;
end; $$;
revoke all on function public.tuki_run_automatic_reminders() from public,anon,authenticated;
grant execute on function public.tuki_run_automatic_reminders() to service_role;

-- Extend the same audited registration engine, not a separate payment ledger.
alter function public.tuki_create_payment(uuid,jsonb,boolean) set schema tuki_private;
alter function tuki_private.tuki_create_payment(uuid,jsonb,boolean) rename to create_payment_phase5;
revoke all on function tuki_private.create_payment_phase5(uuid,jsonb,boolean) from public,anon,authenticated;
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
 approver:=case when actor=receiver then payer else receiver end;
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


create function public.tuki_create_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid; result uuid; p public.payments; part jsonb;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 if p_data ? 'received' and jsonb_typeof(p_data->'received') is distinct from 'boolean' then raise exception 'payment_forbidden';end if;
 if p_data->>'received'='true' and actor is distinct from (p_data->>'receiverId')::uuid then raise exception 'payment_forbidden' using errcode='42501';end if;
 result:=tuki_private.create_payment_phase5(p_id,p_data,p_confirm);
 if p_data->>'received'='true' then
  select * into p from public.payments where id=result for update;
  if p.status='pending' then
   for part in select * from jsonb_array_elements(tuki_private.payment_plan(p.payer_id,p.receiver_id,case when p.scope='group' then p.group_id else null end,p.selected_obligations,p.amount_minor)) loop
    insert into public.payment_allocations(payment_id,obligation_id,amount_minor,actor_id) values(p.id,(part->>'id')::uuid,(part->>'amount')::numeric,actor);
   end loop;
   update public.payments set status='confirmed',version=version+1,confirmed_by=actor,confirmed_at=clock_timestamp(),approval_mode='receiver_receipt',receiver_attested=true where id=p.id;
   insert into public.payment_events(id,payment_id,actor_id,action,from_status,to_status,reason,request_hash) values(gen_random_uuid(),p.id,actor,'confirm','pending','confirmed','Recepción declarada por el receptor autorizado',p.request_hash);
  end if;
 end if;return result;
end; $$;
revoke all on function public.tuki_create_payment(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tuki_create_payment(uuid,jsonb,boolean) to authenticated;

alter function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) set schema tuki_private;
alter function tuki_private.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) rename to transition_payment_phase5;
revoke all on function tuki_private.transition_payment_phase5(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
create function public.tuki_transition_payment(p_id uuid,p_version integer,p_action text,p_reason text,p_request_id uuid,p_confirm boolean) returns void language plpgsql security definer set search_path='' as $$
declare actor uuid; p public.payments; previous public.payment_events; digest text;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into p from public.payments where id=p_id;
 if p.approval_mode='receiver_receipt' and p_action='void' then
  if p_confirm is distinct from true or actor<>p.receiver_id then raise exception 'payment_forbidden' using errcode='42501';end if;
  if p_reason is null or char_length(btrim(p_reason))<8 or char_length(p_reason)>500 then raise exception 'payment_reason_required';end if;
  digest:=encode(sha256(convert_to(jsonb_build_array(p_id,p_version,p_action,p_reason)::text,'UTF8')),'hex');
  select * into previous from public.payment_events where id=p_request_id;
  if found then if previous.actor_id=actor and previous.request_hash=digest then return;else raise exception 'payment_idempotency_conflict';end if;end if;
  if p.status<>'confirmed' or p.version is distinct from p_version then raise exception 'payment_conflict';end if;
  update public.payment_allocations set reversed_at=clock_timestamp(),reversed_by=actor where payment_id=p.id and reversed_at is null;
  update public.payments set status='void',version=version+1 where id=p.id;
  insert into public.payment_events(id,payment_id,actor_id,action,from_status,to_status,reason,request_hash) values(p_request_id,p.id,actor,'void','confirmed','void',p_reason,digest);
 else perform tuki_private.transition_payment_phase5(p_id,p_version,p_action,p_reason,p_request_id,p_confirm);end if;
end; $$;
revoke all on function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) to authenticated;

-- Receiver-attested payments can be reversed by that same receiver in the UI.
alter function public.tuki_payment_workspace(uuid) set schema tuki_private;
alter function tuki_private.tuki_payment_workspace(uuid) rename to payment_workspace_phase5;
revoke all on function tuki_private.payment_workspace_phase5(uuid) from public,anon,authenticated;
create function public.tuki_payment_workspace(p_group_id uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; actor uuid; received_options jsonb;
begin
 result:=tuki_private.payment_workspace_phase5(p_group_id);actor:=tuki_private.current_person();
 result:=result||jsonb_build_object('quick_receipts',true);
 select coalesce(jsonb_agg(jsonb_build_object('payer_id',d.id,'receiver_id',actor,'payer_name',d.display_name,'receiver_name',c.display_name,'scope','global','max_minor',tuki_private.pair_balance(d.id,actor,null)::text)),'[]') into received_options
 from public.persons d join public.persons c on c.id=actor where d.merged_into is null and d.id<>actor and tuki_private.pair_balance(d.id,actor,null)>0
 and(p_group_id is null or(exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=d.id and m.replaced_by_person_id is null) and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=actor and m.replaced_by_person_id is null)));
 result:=jsonb_set(result,'{options}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'options') x where (x->>'receiver_id')::uuid<>actor),'[]')||received_options);
 return jsonb_set(result,'{payments}',coalesce((select jsonb_agg(x||jsonb_build_object('can_void',(x->>'can_void')::boolean or(x->>'approval_mode'='receiver_receipt' and x->>'status'='confirmed' and (x->>'receiver_id')::uuid=actor))) from jsonb_array_elements(result->'payments') x),'[]'));
end; $$;
revoke all on function public.tuki_payment_workspace(uuid) from public,anon,authenticated;
grant execute on function public.tuki_payment_workspace(uuid) to authenticated;

create or replace function tuki_private.removal_schema_known() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions','receipt_scan_requests','payments','payment_allocations','payment_events','notifications','notification_preferences'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass) and n.nspname<>'public' and not(n.nspname='tuki_private' and r.relname in('notification_outbox','reminder_log','automatic_reminder_runs')))
$$;

notify pgrst,'reload schema';
commit;
