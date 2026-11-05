-- Group chat. Apply manually after 202611040005_feedback.sql.
begin;

do $$
begin
  if pg_catalog.to_regprocedure('tuki_private.is_member(uuid)') is null
    or pg_catalog.to_regprocedure('tuki_private.current_person()') is null
    or pg_catalog.to_regprocedure('public.tuki_ensure_person()') is null
    or pg_catalog.to_regclass('public.expense_events') is null
    or pg_catalog.to_regclass('public.payment_events') is null then
    raise exception 'chat_prerequisites_required: apply the existing group and finance migrations first';
  end if;
end $$;

create table public.group_chat_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  sender_person_id uuid references public.persons(id),
  client_message_id uuid,
  content text not null check (char_length(btrim(content)) between 1 and 2000),
  message_kind text not null check (message_kind in ('user', 'system')),
  system_event_key text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check (
    (message_kind = 'user' and sender_person_id is not null and client_message_id is not null and system_event_key is null)
    or (message_kind = 'system' and sender_person_id is null and client_message_id is null and system_event_key is not null)
  )
);
create unique index group_chat_messages_client_request
  on public.group_chat_messages(group_id, sender_person_id, client_message_id)
  where sender_person_id is not null and client_message_id is not null;
create index group_chat_messages_page
  on public.group_chat_messages(group_id, created_at desc, id desc);

create table public.group_chat_reads (
  group_id uuid not null references public.groups(id),
  person_id uuid not null references public.persons(id),
  last_read_at timestamptz not null,
  primary key (group_id, person_id)
);

create table public.group_chat_preferences (
  group_id uuid not null references public.groups(id),
  person_id uuid not null references public.persons(id),
  muted boolean not null default false,
  updated_at timestamptz not null default clock_timestamp(),
  primary key (group_id, person_id)
);

alter table public.group_chat_messages enable row level security;
alter table public.group_chat_reads enable row level security;
alter table public.group_chat_preferences enable row level security;
revoke all on public.group_chat_messages, public.group_chat_reads, public.group_chat_preferences from public, anon, authenticated;
grant select on public.group_chat_messages, public.group_chat_reads, public.group_chat_preferences to authenticated;

create policy group_chat_messages_read on public.group_chat_messages
  for select to authenticated using (tuki_private.is_member(group_id));
create policy group_chat_reads_own on public.group_chat_reads
  for select to authenticated using (person_id = tuki_private.current_person() and tuki_private.is_member(group_id));
create policy group_chat_preferences_own on public.group_chat_preferences
  for select to authenticated using (person_id = tuki_private.current_person() and tuki_private.is_member(group_id));

create function public.tuki_send_group_chat_message(p_group_id uuid, p_client_message_id uuid, p_content text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  archived timestamptz;
  clean_content text;
  prior public.group_chat_messages;
  created public.group_chat_messages;
  recent_count integer;
begin
  actor := public.tuki_ensure_person();
  clean_content := btrim(p_content);
  if p_client_message_id is null or clean_content is null or char_length(clean_content) not between 1 and 2000 then
    raise exception 'chat_invalid_message';
  end if;

  select archived_at into archived from public.groups where id = p_group_id for share;
  if not found or not tuki_private.is_member(p_group_id) then
    raise exception 'group_forbidden' using errcode = '42501';
  end if;
  if archived is not null then raise exception 'group_archived'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_id::text || ':' || actor::text, 0));
  select * into prior from public.group_chat_messages
    where group_id = p_group_id and sender_person_id = actor and client_message_id = p_client_message_id;
  if found then
    if prior.content is distinct from clean_content then raise exception 'chat_idempotency_conflict'; end if;
    return pg_catalog.to_jsonb(prior);
  end if;

  select count(*)::integer into recent_count from public.group_chat_messages
    where group_id = p_group_id and sender_person_id = actor and message_kind = 'user'
      and created_at > clock_timestamp() - interval '1 minute';
  if recent_count >= 12 then raise exception 'chat_rate_limited'; end if;

  insert into public.group_chat_messages(group_id, sender_person_id, client_message_id, content, message_kind)
    values (p_group_id, actor, p_client_message_id, clean_content, 'user')
    on conflict do nothing returning * into created;
  if created.id is null then
    select * into prior from public.group_chat_messages
      where group_id = p_group_id and sender_person_id = actor and client_message_id = p_client_message_id;
    if not found or prior.content is distinct from clean_content then raise exception 'chat_idempotency_conflict'; end if;
    created := prior;
  end if;
  return pg_catalog.to_jsonb(created);
end;
$$;

create function public.tuki_group_chat_mark_read(p_group_id uuid)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  read_at timestamptz;
begin
  actor := tuki_private.current_person();
  if actor is null or not tuki_private.is_member(p_group_id) then
    raise exception 'group_forbidden' using errcode = '42501';
  end if;
  insert into public.group_chat_reads(group_id, person_id, last_read_at)
    values (p_group_id, actor, coalesce((select max(created_at) from public.group_chat_messages where group_id = p_group_id), clock_timestamp()))
    on conflict (group_id, person_id) do update
      set last_read_at = greatest(public.group_chat_reads.last_read_at, excluded.last_read_at)
    returning last_read_at into read_at;
  return read_at;
end;
$$;

create function public.tuki_group_chat_unread_count(p_group_id uuid)
returns integer language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid;
  read_at timestamptz;
  unread integer;
begin
  actor := tuki_private.current_person();
  if actor is null or not tuki_private.is_member(p_group_id) then
    raise exception 'group_forbidden' using errcode = '42501';
  end if;
  select last_read_at into read_at from public.group_chat_reads where group_id = p_group_id and person_id = actor;
  select count(*)::integer into unread from public.group_chat_messages
    where group_id = p_group_id and sender_person_id is distinct from actor and deleted_at is null
      and (read_at is null or created_at > read_at);
  return unread;
end;
$$;

create function public.tuki_group_chat_set_muted(p_group_id uuid, p_muted boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare actor uuid;
begin
  actor := tuki_private.current_person();
  if actor is null or p_muted is null or not tuki_private.is_member(p_group_id) then
    raise exception 'group_forbidden' using errcode = '42501';
  end if;
  insert into public.group_chat_preferences(group_id, person_id, muted)
    values (p_group_id, actor, p_muted)
    on conflict (group_id, person_id) do update
      set muted = excluded.muted, updated_at = clock_timestamp();
  return p_muted;
end;
$$;

create function public.tuki_group_chat_delete_message(p_group_id uuid, p_message_id uuid, p_confirm boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  actor uuid;
  archived timestamptz;
  target public.group_chat_messages;
begin
  actor := tuki_private.current_person();
  if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
  select archived_at into archived from public.groups where id = p_group_id for share;
  if not found or actor is null or not tuki_private.is_member(p_group_id) then
    raise exception 'group_forbidden' using errcode = '42501';
  end if;
  if archived is not null then raise exception 'group_archived'; end if;
  select * into target from public.group_chat_messages where id = p_message_id and group_id = p_group_id for update;
  if not found or target.message_kind <> 'user' then raise exception 'chat_message_forbidden' using errcode = '42501'; end if;
  if target.sender_person_id <> actor and not tuki_private.is_admin(p_group_id) then
    raise exception 'chat_message_forbidden' using errcode = '42501';
  end if;
  if target.deleted_at is not null then return; end if;
  update public.group_chat_messages set content = 'Mensaje eliminado', deleted_at = clock_timestamp()
    where id = p_message_id;
end;
$$;

create function tuki_private.chat_format_uyu(amount_minor numeric) returns text
language sql immutable set search_path = '' as $$
  select '$' || pg_catalog.to_char(pg_catalog.trunc(amount_minor / 100), 'FM999999999999990')
    || ',' || pg_catalog.lpad(pg_catalog.mod(amount_minor, 100)::text, 2, '0')
$$;
revoke all on function tuki_private.chat_format_uyu(numeric) from public, anon, authenticated;

create function tuki_private.chat_expense_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_name text;
  expense_title text;
  amount_minor numeric;
  message_text text;
begin
  if new.kind not in ('created', 'edited', 'voided') then return new; end if;
  select display_name into actor_name from public.persons where id = new.actor_id;
  select title, total_minor into expense_title, amount_minor from public.expense_revisions
    where expense_id = new.expense_id and version = new.version;
  actor_name := coalesce(actor_name, 'Un integrante');
  expense_title := coalesce(expense_title, 'un gasto');
  if new.kind = 'created' then
    message_text := actor_name || ' agregó un gasto de ' || tuki_private.chat_format_uyu(amount_minor) || ' · ' || expense_title || '.';
  elsif new.kind = 'edited' then
    message_text := actor_name || ' actualizó el gasto «' || expense_title || '».';
  else
    message_text := actor_name || ' anuló el gasto «' || expense_title || '».';
  end if;
  insert into public.group_chat_messages(group_id, content, message_kind, system_event_key, metadata)
    values (new.group_id, message_text, 'system',
      'expense:' || new.expense_id::text || ':' || new.version::text || ':' || new.kind,
      jsonb_build_object('entityType', 'expense', 'entityId', new.expense_id, 'href', '/gastos/' || new.expense_id::text))
    on conflict do nothing;
  return new;
end;
$$;

create function tuki_private.chat_payment_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  group_key uuid;
  payer uuid;
  receiver uuid;
  amount_minor numeric;
  payment_scope text;
  payer_name text;
  receiver_name text;
  actor_name text;
  message_text text;
begin
  select payer_id, receiver_id, payments.amount_minor, scope into payer, receiver, amount_minor, payment_scope
    from public.payments where id = new.payment_id;
  if not found then return new; end if;
  select display_name into payer_name from public.persons where id = payer;
  select display_name into receiver_name from public.persons where id = receiver;
  select display_name into actor_name from public.persons where id = new.actor_id;
  payer_name := coalesce(payer_name, 'Un integrante');
  receiver_name := coalesce(receiver_name, 'un integrante');
  actor_name := coalesce(actor_name, 'Un integrante');

  if new.action = 'created' then
    message_text := actor_name || ' registró un pago de ' || tuki_private.chat_format_uyu(amount_minor)
      || ' de ' || payer_name || ' a ' || receiver_name || ' · pendiente de confirmación.';
  elsif new.action = 'confirm' then
    message_text := actor_name || ' confirmó el pago de ' || tuki_private.chat_format_uyu(amount_minor)
      || ' de ' || payer_name || ' a ' || receiver_name || '.';
  elsif new.action = 'reject' then
    message_text := actor_name || ' rechazó el pago de ' || tuki_private.chat_format_uyu(amount_minor)
      || ' de ' || payer_name || ' a ' || receiver_name || '.';
  else
    message_text := actor_name || ' anuló el pago de ' || tuki_private.chat_format_uyu(amount_minor)
      || ' de ' || payer_name || ' a ' || receiver_name || '.';
  end if;
  for group_key in
    select p.group_id from public.payments p where p.id = new.payment_id and p.group_id is not null
    union
    select o.group_id from public.payments p
      cross join lateral unnest(p.selected_obligations) selected(obligation_id)
      join public.obligations o on o.id = selected.obligation_id
      where p.id = new.payment_id
    union
    select o.group_id from public.payment_allocations a
      join public.obligations o on o.id = a.obligation_id
      where a.payment_id = new.payment_id
  loop
    insert into public.group_chat_messages(group_id, content, message_kind, system_event_key, metadata)
      values (group_key, message_text, 'system', 'payment:' || new.id::text || ':' || group_key::text,
        jsonb_build_object('entityType', 'payment', 'entityId', new.payment_id,
          'scope', payment_scope, 'payerId', payer, 'receiverId', receiver,
          'href', '/pagos?grupo=' || group_key::text || '#pago-' || new.payment_id::text))
      on conflict do nothing;
  end loop;
  return new;
end;
$$;

create trigger group_chat_expense_event
  after insert on public.expense_events for each row execute function tuki_private.chat_expense_event();
create trigger group_chat_payment_event
  after insert on public.payment_events for each row execute function tuki_private.chat_payment_event();

revoke all on function public.tuki_send_group_chat_message(uuid, uuid, text),
  public.tuki_group_chat_mark_read(uuid), public.tuki_group_chat_unread_count(uuid),
  public.tuki_group_chat_set_muted(uuid, boolean), public.tuki_group_chat_delete_message(uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.tuki_send_group_chat_message(uuid, uuid, text),
  public.tuki_group_chat_mark_read(uuid), public.tuki_group_chat_unread_count(uuid),
  public.tuki_group_chat_set_muted(uuid, boolean), public.tuki_group_chat_delete_message(uuid, uuid, boolean)
  to authenticated;
revoke all on function tuki_private.chat_expense_event(), tuki_private.chat_payment_event() from public, anon, authenticated;

do $$
declare table_name text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication is unavailable; group chat will not receive live updates until enabled';
  else
    foreach table_name in array array['group_chat_messages', 'group_chat_reads', 'group_chat_preferences'] loop
      if not exists (select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute pg_catalog.format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
end $$;

-- Safe removal explicitly recognizes and clears chat-owned rows. Chat rows do
-- not cascade into global persons or other groups.
create or replace function tuki_private.removal_schema_known()
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'f')
      and c.relname not in (
        'profiles','persons','groups','group_members','group_invitations','group_events',
        'expenses','expense_revisions','expense_shares','expense_people_history','obligations',
        'expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions',
        'receipt_scan_requests','payments','payment_allocations','payment_events','notifications',
        'notification_preferences','bank_accounts','group_chat_messages','group_chat_reads',
        'group_chat_preferences'
      )
  ) and not exists (
    select 1 from pg_catalog.pg_constraint c
    join pg_catalog.pg_class r on r.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = r.relnamespace
    where c.contype = 'f'
      and c.confrelid in ('public.persons'::regclass, 'public.groups'::regclass, 'public.group_members'::regclass)
      and n.nspname <> 'public'
      and not (
        (n.nspname = 'tuki_private' and r.relname in ('notification_outbox','reminder_log','automatic_reminder_runs'))
        or (n.nspname = 'tuki_private' and r.relname = 'scan_jobs'
          and c.confrelid = 'public.groups'::regclass and c.confdeltype = 'c')
      )
  )
$$;
revoke all on function tuki_private.removal_schema_known() from public, anon, authenticated;

create or replace function tuki_private.delete_group_before_avatar(p_group_id uuid, p_confirm boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare actor uuid; owner uuid; payment_ids uuid[]; obligation_ids uuid[];
begin
  if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
  actor := public.tuki_ensure_person();
  perform tuki_private.lock_finance();
  select created_by into owner from public.groups where id = p_group_id for update;
  if not found then
    if exists(select 1 from public.lifecycle_audit where entity_type = 'group' and entity_id = p_group_id and actor_id = actor and result = 'deleted') then return; end if;
    raise exception 'group_owner_required' using errcode = '42501';
  end if;
  if owner <> actor or not tuki_private.is_member(p_group_id) then
    raise exception 'group_owner_required' using errcode = '42501';
  end if;
  if not tuki_private.removal_schema_known() then raise exception 'removal_schema_changed'; end if;

  if exists (
    select 1 from pg_catalog.pg_constraint c where c.contype = 'f'
      and c.confrelid = any(array[
        'public.groups'::regclass,'public.group_members'::regclass,'public.group_invitations'::regclass,
        'public.group_events'::regclass,'public.expenses'::regclass,'public.expense_revisions'::regclass,
        'public.expense_shares'::regclass,'public.expense_people_history'::regclass,'public.obligations'::regclass,
        'public.expense_events'::regclass,'public.payments'::regclass,'public.payment_allocations'::regclass,
        'public.payment_events'::regclass,'public.ticket_uploads'::regclass,'public.smart_bill_revisions'::regclass
      ])
      and c.conrelid <> all(array[
        'public.groups'::regclass,'public.group_members'::regclass,'public.group_invitations'::regclass,
        'public.group_events'::regclass,'public.expenses'::regclass,'public.expense_revisions'::regclass,
        'public.expense_shares'::regclass,'public.expense_people_history'::regclass,'public.obligations'::regclass,
        'public.expense_events'::regclass,'public.payments'::regclass,'public.payment_allocations'::regclass,
        'public.payment_events'::regclass,'public.ticket_uploads'::regclass,'public.smart_bill_revisions'::regclass,
        'public.group_chat_messages'::regclass,'public.group_chat_reads'::regclass,'public.group_chat_preferences'::regclass,
        'tuki_private.notification_outbox'::regclass,'tuki_private.scan_jobs'::regclass
      ])
  ) then raise exception 'removal_schema_changed'; end if;

  select coalesce(array_agg(id), '{}') into obligation_ids from public.obligations where group_id = p_group_id;
  select coalesce(array_agg(p.id), '{}') into payment_ids from public.payments p where p.group_id = p_group_id
    or p.selected_obligations && obligation_ids
    or exists(select 1 from public.payment_allocations a where a.payment_id = p.id and a.obligation_id = any(obligation_ids));
  if exists (
    select 1 from public.payments p where p.id = any(payment_ids) and
      ((p.group_id is not null and p.group_id <> p_group_id)
        or exists(select 1 from public.payment_allocations a join public.obligations o on o.id = a.obligation_id where a.payment_id = p.id and o.group_id <> p_group_id)
        or exists(select 1 from unnest(p.selected_obligations) s where not (s = any(obligation_ids))))
  ) or exists (
    select 1 from tuki_private.payment_operations op where op.payload is not null
      and (op.payload->>'groupId' = p_group_id::text or op.id = any(payment_ids)
        or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected') = 'array' then op.payload->'selected' else '[]'::jsonb end) s where s = any(select id::text from public.obligations where group_id = p_group_id)))
      and ((nullif(op.payload->>'groupId', '') is not null and op.payload->>'groupId' <> p_group_id::text)
        or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected') = 'array' then op.payload->'selected' else '[]'::jsonb end) s where not (s = any(select id::text from public.obligations where group_id = p_group_id))))
  ) or exists (
    select 1 from public.smart_bill_revisions s join public.ticket_uploads u on u.id = s.upload_id
      where u.group_id = p_group_id and s.group_id <> p_group_id
  ) then raise exception 'group_shared_financial_history'; end if;

  insert into tuki_private.group_file_deletions(group_id, path)
    select p_group_id, path from public.ticket_uploads where group_id = p_group_id on conflict do nothing;
  update tuki_private.payment_operations op set state = 'cancelled', payload = null, error_code = null, acknowledged_at = clock_timestamp()
    where op.id = any(payment_ids) or op.payload->>'groupId' = p_group_id::text
      or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected') = 'array' then op.payload->'selected' else '[]'::jsonb end) s where s = any(select id::text from public.obligations where group_id = p_group_id));
  delete from public.notifications n where exists(select 1 from tuki_private.notification_outbox o
      where o.user_id = n.user_id and o.event_key = n.event_key and (o.group_id = p_group_id or o.payment_id = any(payment_ids)
        or o.expense_id in(select id from public.expenses where group_id = p_group_id)))
    or n.href = '/grupos/' || p_group_id::text
    or n.href in(select '/gastos/' || id::text from public.expenses where group_id = p_group_id)
    or n.href in(select '/pagos#pago-' || unnest(payment_ids)::text);
  delete from tuki_private.notification_outbox where group_id = p_group_id or payment_id = any(payment_ids)
    or expense_id in(select id from public.expenses where group_id = p_group_id);
  delete from public.payment_events where payment_id = any(payment_ids);
  delete from public.payment_allocations where payment_id = any(payment_ids);
  delete from public.payments where id = any(payment_ids);
  delete from public.smart_bill_revisions where group_id = p_group_id;
  delete from public.ticket_uploads where group_id = p_group_id;
  delete from tuki_private.scan_jobs where group_id = p_group_id;
  delete from public.obligations where group_id = p_group_id;
  delete from public.expense_shares where revision_id in(select id from public.expense_revisions where group_id = p_group_id);
  delete from public.expense_people_history where group_id = p_group_id;
  delete from public.expense_events where group_id = p_group_id;
  delete from public.expense_revisions where group_id = p_group_id;
  delete from public.expenses where group_id = p_group_id;
  delete from public.group_chat_messages where group_id = p_group_id;
  delete from public.group_chat_reads where group_id = p_group_id;
  delete from public.group_chat_preferences where group_id = p_group_id;
  delete from public.group_events where group_id = p_group_id;
  delete from public.group_invitations where group_id = p_group_id;
  delete from public.group_members where group_id = p_group_id;
  delete from public.groups where id = p_group_id;
  insert into public.lifecycle_audit(actor_id, entity_type, entity_id, result) values(actor, 'group', p_group_id, 'deleted');
end;
$$;

notify pgrst, 'reload schema';
commit;
