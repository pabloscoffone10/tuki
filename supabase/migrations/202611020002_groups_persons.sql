-- Phase 3. Apply after 202611020001_account_profiles.sql, once, by project owner.
-- No remote execution, deletes, financial tables, guest claims or identity merges.
begin;
-- Fail before creating Phase 3 objects if the expected Phase 2 foundation is missing.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_class where oid=pg_catalog.to_regclass('public.profiles') and relkind='r' and relrowsecurity)
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='user_id' and data_type='uuid')
    or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='display_name' and data_type='text') then
    raise exception 'phase2_profiles_required: apply the original Phase 2 migration with RLS before Phase 3';
  end if;
  if not exists (select 1 from pg_catalog.pg_trigger where tgrelid=pg_catalog.to_regclass('auth.users') and tgname='tuki_auth_user_created' and tgenabled in ('O','A') and not tgisinternal) then
    raise exception 'phase2_auth_trigger_required: the Phase 2 profile creation trigger must be enabled';
  end if;
end $$;
create schema tuki_private;
revoke all on schema tuki_private from public, anon, authenticated;
grant usage on schema tuki_private to authenticated;

create table public.persons (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
  user_id uuid unique references auth.users(id) on delete set null,
  merged_into uuid references public.persons(id),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (merged_into is null or (merged_into <> id and user_id is null))
);
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 1000),
  kind text not null check (kind in ('permanent', 'temporary')),
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.group_members (
  group_id uuid not null references public.groups(id),
  person_id uuid not null references public.persons(id),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'active' check (status in ('active', 'retired', 'invited')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  retired_at timestamptz,
  primary key (group_id, person_id),
  check (role <> 'admin' or status in ('active', 'retired')),
  check ((status = 'retired') = (retired_at is not null))
);
create index group_members_person on public.group_members(person_id, status, group_id);
create table public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references public.persons(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references public.persons(id),
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null))
);
create index group_invitations_group on public.group_invitations(group_id);
create table public.group_events (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id),
  actor_id uuid not null references public.persons(id),
  event_type text not null check (event_type in ('created','edited','archived','restored','guest_added','person_added','guest_renamed','member_changed','invitation_created','invitation_revoked','invitation_accepted')),
  subject_id uuid references public.persons(id),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);
create index group_events_group on public.group_events(group_id, created_at desc);

-- All clients are read-only at table level. Writes go through narrowly scoped RPCs.
alter table public.persons enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_invitations enable row level security;
alter table public.group_events enable row level security;
revoke all on public.persons, public.groups, public.group_members, public.group_invitations, public.group_events from public, anon, authenticated;
grant select on public.persons, public.groups, public.group_members, public.group_events to authenticated;
-- Never return stored token hashes through PostgREST, including to admins.
grant select (id, group_id, created_by, created_at, expires_at, revoked_at, accepted_at, accepted_by) on public.group_invitations to authenticated;

create function tuki_private.current_person() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.persons where user_id = (select auth.uid()) and merged_into is null
$$;
create function tuki_private.is_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and person_id = tuki_private.current_person() and status = 'active')
$$;
create function tuki_private.is_admin(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members where group_id = g and person_id = tuki_private.current_person() and status = 'active' and role = 'admin')
$$;
create function tuki_private.can_view_person(p uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.persons where id = p and (user_id = (select auth.uid()) or created_by = (select auth.uid())))
  or exists (select 1 from public.group_members target join public.group_members viewer on viewer.group_id = target.group_id
    where target.person_id = p and viewer.person_id = tuki_private.current_person() and viewer.status = 'active'
      and (target.status = 'active' or viewer.role = 'admin'))
$$;
revoke all on function tuki_private.current_person(), tuki_private.is_member(uuid), tuki_private.is_admin(uuid), tuki_private.can_view_person(uuid) from public, anon, authenticated;
grant execute on function tuki_private.current_person(), tuki_private.is_member(uuid), tuki_private.is_admin(uuid), tuki_private.can_view_person(uuid) to authenticated;

create policy persons_read_authorized on public.persons for select to authenticated using (tuki_private.can_view_person(id));
create policy groups_read_members on public.groups for select to authenticated using (tuki_private.is_member(id));
create policy members_read_members on public.group_members for select to authenticated using (tuki_private.is_member(group_id));
create policy invitations_read_admin on public.group_invitations for select to authenticated using (tuki_private.is_admin(group_id));
create policy events_read_members on public.group_events for select to authenticated using (tuki_private.is_member(group_id));

-- Extend the existing profiles lifecycle, without replacing the Phase 2 Auth trigger.
create function tuki_private.profile_person() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.persons(display_name, user_id, created_by)
  values (coalesce(nullif(btrim(new.display_name), ''), 'Mi cuenta'), new.user_id, new.user_id)
  on conflict (user_id) do nothing;
  return new;
end; $$;
revoke all on function tuki_private.profile_person() from public, anon, authenticated;
create trigger tuki_profile_person after insert on public.profiles for each row execute function tuki_private.profile_person();
insert into public.persons(display_name, user_id, created_by)
select coalesce(nullif(btrim(p.display_name), ''), 'Mi cuenta'), u.id, u.id
from auth.users u left join public.profiles p on p.user_id = u.id
on conflict (user_id) do nothing;

create function public.tuki_ensure_person() returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  insert into public.persons(display_name, user_id, created_by)
  select coalesce(nullif(btrim(p.display_name), ''), 'Mi cuenta'), u.id, u.id
  from auth.users u left join public.profiles p on p.user_id = u.id where u.id = auth.uid()
  on conflict (user_id) do nothing;
  select id into result from public.persons where user_id = auth.uid() and merged_into is null;
  if result is null then raise exception 'identity_unavailable'; end if;
  return result;
end; $$;

-- Serialize every mutation in a group on the group row. Check permissions AFTER
-- taking the lock so concurrent demotion/retirement cannot use stale authority.
create function tuki_private.lock_admin(g uuid, allow_archived boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare archived timestamptz;
begin
  perform public.tuki_ensure_person();
  select archived_at into archived from public.groups where id = g for update;
  if not found or not tuki_private.is_admin(g) then raise exception 'group_forbidden' using errcode = '42501'; end if;
  if archived is not null and not allow_archived then raise exception 'group_archived'; end if;
end; $$;
create function tuki_private.event(g uuid, kind text, subject uuid default null, metadata jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = '' as $$
  insert into public.group_events(group_id, actor_id, event_type, subject_id, details)
  values (g, tuki_private.current_person(), kind, subject, metadata)
$$;
revoke all on function tuki_private.lock_admin(uuid,boolean), tuki_private.event(uuid,text,uuid,jsonb) from public, anon, authenticated;

create function public.tuki_create_group(p_name text, p_description text, p_kind text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person uuid; result uuid;
begin
  person := public.tuki_ensure_person();
  insert into public.groups(name, description, kind, created_by) values (btrim(p_name), p_description, p_kind, person) returning id into result;
  insert into public.group_members(group_id,person_id,role,status) values (result,person,'admin','active');
  perform tuki_private.event(result,'created');
  return result;
end; $$;
create function public.tuki_update_group(p_group_id uuid, p_name text, p_description text, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tuki_private.lock_admin(p_group_id);
  update public.groups set name=btrim(p_name), description=p_description, kind=p_kind, updated_at=now() where id=p_group_id;
  perform tuki_private.event(p_group_id,'edited');
end; $$;
create function public.tuki_archive_group(p_group_id uuid, p_archived boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_archived is null then raise exception 'invalid_input'; end if;
  perform tuki_private.lock_admin(p_group_id,true);
  update public.groups set archived_at=case when p_archived then coalesce(archived_at,now()) else null end, updated_at=now() where id=p_group_id;
  perform tuki_private.event(p_group_id,case when p_archived then 'archived' else 'restored' end);
end; $$;

create function public.tuki_add_guest(p_group_id uuid, p_name text default null, p_person_id uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare person uuid;
begin
  perform tuki_private.lock_admin(p_group_id);
  if p_person_id is null then
    insert into public.persons(display_name,created_by) values (btrim(p_name),auth.uid()) returning id into person;
  else
    select id into person from public.persons where id=p_person_id and user_id is null and merged_into is null and created_by=auth.uid() for update;
    if person is null then raise exception 'person_forbidden' using errcode='42501'; end if;
  end if;
  -- A unique key keeps retries from duplicating memberships. A retired member
  -- must be explicitly reactivated; adding an existing ID never silently resets it.
  if exists (select 1 from public.group_members where group_id=p_group_id and person_id=person) then raise exception 'member_exists' using errcode='23505'; end if;
  insert into public.group_members(group_id,person_id) values (p_group_id,person);
  perform tuki_private.event(p_group_id,case when p_person_id is null then 'guest_added' else 'person_added' end,person);
  return person;
end; $$;
create function public.tuki_rename_guest(p_group_id uuid, p_person_id uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tuki_private.lock_admin(p_group_id);
  if not exists (select 1 from public.group_members where group_id=p_group_id and person_id=p_person_id) then raise exception 'person_forbidden' using errcode='42501'; end if;
  update public.persons set display_name=btrim(p_name), updated_at=now()
  where id=p_person_id and user_id is null and merged_into is null and created_by=auth.uid();
  if not found then raise exception 'person_forbidden' using errcode='42501'; end if;
  perform tuki_private.event(p_group_id,'guest_renamed',p_person_id);
end; $$;
create function public.tuki_set_member(p_group_id uuid, p_person_id uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.group_members; actor uuid; archived timestamptz;
begin
  -- Validate in SQL as well as Zod: RPCs can be called without the UI.
  if p_role is null or p_status is null or p_role not in ('admin','member')
    or p_status not in ('active','retired','invited') or (p_role='admin' and p_status='invited') then
    raise exception 'invalid_member_state' using errcode='22023';
  end if;
  actor := public.tuki_ensure_person();
  select archived_at into archived from public.groups where id=p_group_id for update;
  if not found or not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501'; end if;
  if archived is not null then raise exception 'group_archived'; end if;
  select * into target from public.group_members where group_id=p_group_id and person_id=p_person_id for update;
  if not found then raise exception 'person_forbidden' using errcode='42501'; end if;
  if not tuki_private.is_admin(p_group_id) and not (actor=p_person_id and p_status='retired' and p_role=target.role) then
    raise exception 'group_forbidden' using errcode='42501';
  end if;
  if p_status<>'retired' and exists (select 1 from public.persons where id=p_person_id and merged_into is not null) then
    raise exception 'person_forbidden' using errcode='42501';
  end if;
  if p_role='admin' and not exists (select 1 from public.persons where id=p_person_id and user_id is not null and merged_into is null) then raise exception 'admin_requires_account'; end if;
  if target.role='admin' and target.status='active' and (p_role<>'admin' or p_status<>'active')
    and (select count(*) from public.group_members where group_id=p_group_id and role='admin' and status='active') <= 1 then raise exception 'last_admin'; end if;
  update public.group_members set role=p_role,status=p_status,updated_at=now(),retired_at=case when p_status='retired' then coalesce(retired_at,now()) else null end
  where group_id=p_group_id and person_id=p_person_id;
  perform tuki_private.event(p_group_id,'member_changed',p_person_id,
    jsonb_build_object('role_before',target.role,'role_after',p_role,'status_before',target.status,'status_after',p_status));
end; $$;

create function public.tuki_create_invitation(p_group_id uuid, p_token_hash text, p_hours integer default 72) returns uuid
language plpgsql security definer set search_path = '' as $$
declare result uuid;
begin
  perform tuki_private.lock_admin(p_group_id);
  if p_hours is null or p_hours<1 or p_hours>168 then raise exception 'invalid_input'; end if;
  insert into public.group_invitations(group_id, token_hash, created_by, expires_at)
  values (p_group_id,p_token_hash,tuki_private.current_person(),clock_timestamp()+make_interval(hours=>p_hours)) returning id into result;
  perform tuki_private.event(p_group_id,'invitation_created');
  return result;
end; $$;
create function public.tuki_revoke_invitation(p_group_id uuid, p_invitation_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform tuki_private.lock_admin(p_group_id,true);
  update public.group_invitations set revoked_at=coalesce(revoked_at,clock_timestamp()) where id=p_invitation_id and group_id=p_group_id and accepted_at is null;
  if not found then raise exception 'invitation_unavailable'; end if;
  perform tuki_private.event(p_group_id,'invitation_revoked');
end; $$;
create function public.tuki_accept_invitation(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare invitation public.group_invitations; membership public.group_members; group_key uuid; actor uuid; archived timestamptz;
begin
  actor := public.tuki_ensure_person();
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'invitation_unavailable'; end if;
  select group_id into group_key from public.group_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex');
  if group_key is null then raise exception 'invitation_unavailable'; end if;
  -- Same lock order as admin operations: group, then invitation.
  select archived_at into archived from public.groups where id=group_key for update;
  if not found then raise exception 'invitation_unavailable'; end if;
  select * into invitation from public.group_invitations where token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex') for update;
  if not found then raise exception 'invitation_unavailable'; end if;
  if invitation.revoked_at is not null then raise exception 'invitation_revoked'; end if;
  if invitation.expires_at <= clock_timestamp() then raise exception 'invitation_expired'; end if;
  if archived is not null then raise exception 'group_archived'; end if;
  select * into membership from public.group_members where group_id=group_key and person_id=actor for update;
  -- A generic link is not consent to undo a retirement. Only an active admin
  -- may explicitly reactivate an existing retired membership via set_member.
  if membership.status='retired' then raise exception 'member_retired'; end if;
  if invitation.accepted_at is not null then
    if invitation.accepted_by=actor and membership.status='active' then return group_key; end if;
    raise exception 'invitation_used';
  end if;
  if membership.status='active' then return group_key; end if;
  if membership.status='invited' then
    update public.group_members set status='active',retired_at=null,updated_at=now() where group_id=group_key and person_id=actor;
  else
    insert into public.group_members(group_id,person_id,role,status) values (group_key,actor,'member','active');
  end if;
  update public.group_invitations set accepted_by=actor,accepted_at=clock_timestamp() where id=invitation.id;
  perform tuki_private.event(group_key,'invitation_accepted',actor);
  return group_key;
end; $$;

revoke all on function public.tuki_ensure_person(), public.tuki_create_group(text,text,text), public.tuki_update_group(uuid,text,text,text), public.tuki_archive_group(uuid,boolean), public.tuki_add_guest(uuid,text,uuid), public.tuki_rename_guest(uuid,uuid,text), public.tuki_set_member(uuid,uuid,text,text), public.tuki_create_invitation(uuid,text,integer), public.tuki_revoke_invitation(uuid,uuid), public.tuki_accept_invitation(text) from public, anon, authenticated;
grant execute on function public.tuki_ensure_person(), public.tuki_create_group(text,text,text), public.tuki_update_group(uuid,text,text,text), public.tuki_archive_group(uuid,boolean), public.tuki_add_guest(uuid,text,uuid), public.tuki_rename_guest(uuid,uuid,text), public.tuki_set_member(uuid,uuid,text,text), public.tuki_create_invitation(uuid,text,integer), public.tuki_revoke_invitation(uuid,uuid), public.tuki_accept_invitation(text) to authenticated;
comment on table public.persons is 'Global identity. No automatic merges or guest claims; all client identity mutations are blocked.';
comment on table public.group_members is 'Independent membership; retirement and archiving never delete identities or membership history.';
commit;
