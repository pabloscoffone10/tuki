-- Narrow pre-financial correction. Apply AFTER the audited Phase 3 migration.
-- No identity merge, global deletion, account changes or rewriting of history.
begin;
do $$
begin
  if pg_catalog.to_regclass('public.group_members') is null
    or coalesce(position('member_retired' in pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure('public.tuki_accept_invitation(text)'))),0)=0 then
    raise exception 'audited_phase3_required: apply the audited Phase 3 foundation before this correction';
  end if;
end $$;

alter table public.group_members
  add column replaced_by_person_id uuid,
  add column replaced_at timestamptz,
  add constraint group_members_replacement_pair check ((replaced_by_person_id is null) = (replaced_at is null)),
  add constraint group_members_replacement_state check (replaced_by_person_id is null or (replaced_by_person_id <> person_id and status='retired' and role='member')),
  add constraint group_members_replacement_target foreign key (group_id,replaced_by_person_id) references public.group_members(group_id,person_id);

alter table public.group_events drop constraint group_events_event_type_check;
alter table public.group_events add constraint group_events_event_type_check check (event_type in (
  'created','edited','archived','restored','guest_added','person_added','guest_renamed',
  'member_changed','invitation_created','invitation_revoked','invitation_accepted','guest_replaced'
));

create function public.tuki_replace_guest(p_group_id uuid, p_source_person_id uuid, p_target_person_id uuid, p_confirm boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare source public.persons; target public.persons; original public.group_members; canonical public.group_members; existing_target boolean;
begin
  if p_confirm is distinct from true then raise exception 'correction_confirmation_required'; end if;
  if p_source_person_id is null or p_target_person_id is null or p_source_person_id=p_target_person_id then raise exception 'invalid_input'; end if;
  perform tuki_private.lock_admin(p_group_id);

  -- This limited tool is intentionally unavailable once the schema grows beyond
  -- Phase 3 (including financial tables without FKs). Future phases must retire
  -- or explicitly redesign it; never guess how to reassign financial records.
  if exists (select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
      ('profiles','persons','groups','group_members','group_invitations','group_events'))
    or exists (select 1 from pg_catalog.pg_constraint c where c.contype='f'
      and c.confrelid in ('public.persons'::regclass,'public.group_members'::regclass,'public.groups'::regclass,'public.group_events'::regclass,'public.group_invitations'::regclass)
      and c.conrelid not in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass,'public.group_invitations'::regclass,'public.group_events'::regclass)) then
    raise exception 'correction_schema_changed';
  end if;

  -- Same group lock as every membership mutation. Lock global people in sorted
  -- order so corrections in two different groups cannot invert these locks.
  perform id from public.persons where id in (p_source_person_id,p_target_person_id) order by id for update;
  select * into source from public.persons where id=p_source_person_id;
  select * into target from public.persons where id=p_target_person_id;
  if source.id is null or target.id is null or source.user_id is not null or target.user_id is not null
    or source.merged_into is not null or target.merged_into is not null or source.created_by is null
    or target.created_by is distinct from auth.uid() then raise exception 'person_forbidden' using errcode='42501'; end if;

  select * into original from public.group_members where group_id=p_group_id and person_id=p_source_person_id for update;
  if not found or original.role<>'member' or original.status<>'active' or original.replaced_by_person_id is not null then
    raise exception 'correction_source_unavailable';
  end if;
  select * into canonical from public.group_members where group_id=p_group_id and person_id=p_target_person_id for update;
  existing_target := found;
  if existing_target and (canonical.role<>'member' or canonical.status<>'active' or canonical.replaced_by_person_id is not null) then
    raise exception 'correction_target_unavailable';
  end if;

  -- A past account/admin, consumed invitation or nontrivial history is not a
  -- plain duplicate guest. Keep those references untouched and refuse correction.
  if exists(select 1 from public.groups where created_by in (p_source_person_id,p_target_person_id))
    or exists(select 1 from public.group_members where person_id in (p_source_person_id,p_target_person_id) and role='admin')
    or exists(select 1 from public.group_invitations where created_by in (p_source_person_id,p_target_person_id) or accepted_by in (p_source_person_id,p_target_person_id))
    or exists(select 1 from public.group_events where actor_id in (p_source_person_id,p_target_person_id))
    or exists(select 1 from public.group_events where group_id=p_group_id and subject_id in (p_source_person_id,p_target_person_id)
      and event_type not in ('guest_added','person_added','guest_renamed'))
    or exists(select 1 from public.group_members where group_id=p_group_id and replaced_by_person_id in (p_source_person_id,p_target_person_id)) then
    raise exception 'correction_history_incompatible';
  end if;

  if not existing_target then
    insert into public.group_members(group_id,person_id,role,status) values (p_group_id,p_target_person_id,'member','active');
  end if;
  update public.group_members set status='retired',retired_at=clock_timestamp(),updated_at=clock_timestamp(),
    replaced_by_person_id=p_target_person_id,replaced_at=clock_timestamp()
    where group_id=p_group_id and person_id=p_source_person_id;
  perform tuki_private.event(p_group_id,'guest_replaced',p_source_person_id,
    jsonb_build_object('source_person_id',p_source_person_id,'target_person_id',p_target_person_id,'target_already_member',existing_target));
end; $$;

-- A replaced historical membership cannot later be reactivated or repurposed.
-- Preserve the audited Phase 3 rules and add only this additional guard.
create or replace function public.tuki_set_member(p_group_id uuid, p_person_id uuid, p_role text, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare target public.group_members; actor uuid; archived timestamptz;
begin
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
  if target.replaced_by_person_id is not null then raise exception 'membership_replaced'; end if;
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

revoke all on function public.tuki_replace_guest(uuid,uuid,uuid,boolean), public.tuki_set_member(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.tuki_replace_guest(uuid,uuid,uuid,boolean), public.tuki_set_member(uuid,uuid,text,text) to authenticated;
notify pgrst, 'reload schema';
commit;
