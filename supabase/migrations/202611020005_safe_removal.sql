-- Phase 4 safe removal. Apply after 004; no remote execution by the application.
begin;
-- Fail closed when future domain tables need a new lifecycle policy.
create function tuki_private.removal_schema_known() returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace
 where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass)
 and n.nspname<>'public')
$$;
revoke all on function tuki_private.removal_schema_known() from public,anon,authenticated;

create function public.tuki_delete_group(p_group_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 perform tuki_private.lock_admin(p_group_id,true); actor:=tuki_private.current_person();
 if not tuki_private.removal_schema_known() then raise exception 'removal_schema_changed'; end if;
 if exists(select 1 from public.groups where id=p_group_id and had_financial_activity)
 or exists(select 1 from public.expenses where group_id=p_group_id) then raise exception 'group_has_financial_history'; end if;
 -- One statement removes self-referencing replacement memberships together.
 delete from public.group_events where group_id=p_group_id;
 delete from public.group_invitations where group_id=p_group_id;
 delete from public.group_members where group_id=p_group_id;
 delete from public.groups where id=p_group_id;
 insert into public.lifecycle_audit(actor_id,entity_type,entity_id,result) values(actor,'group',p_group_id,'deleted');
end; $$;

create function public.tuki_remove_member(p_group_id uuid,p_person_id uuid,p_confirm boolean) returns text
language plpgsql security definer set search_path='' as $$
declare target public.group_members; keep_history boolean;
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 perform tuki_private.lock_admin(p_group_id);
 select * into target from public.group_members where group_id=p_group_id and person_id=p_person_id for update;
 if not found then raise exception 'person_forbidden' using errcode='42501'; end if;
 if target.role='admin' and target.status='active' and (select count(*) from public.group_members where group_id=p_group_id and role='admin' and status='active')<=1 then raise exception 'last_admin'; end if;
 keep_history:=not tuki_private.removal_schema_known() or target.replaced_by_person_id is not null
 or exists(select 1 from public.group_members where group_id=p_group_id and replaced_by_person_id=p_person_id)
 or exists(select 1 from public.expense_people_history where group_id=p_group_id and person_id=p_person_id)
 or exists(select 1 from public.group_invitations where group_id=p_group_id and (created_by=p_person_id or accepted_by=p_person_id))
 or exists(select 1 from public.groups where id=p_group_id and created_by=p_person_id)
 or exists(select 1 from public.group_events where group_id=p_group_id and
 (actor_id=p_person_id or (subject_id=p_person_id and event_type not in ('guest_added','person_added','guest_renamed'))));
 if keep_history then
   if target.status<>'retired' then
     update public.group_members set status='retired',retired_at=clock_timestamp(),updated_at=clock_timestamp() where group_id=p_group_id and person_id=p_person_id;
     perform tuki_private.event(p_group_id,'member_changed',p_person_id,jsonb_build_object('role_before',target.role,'role_after',target.role,'status_before',target.status,'status_after','retired'));
   end if;
   return 'retired';
 end if;
 delete from public.group_members where group_id=p_group_id and person_id=p_person_id;
 perform tuki_private.event(p_group_id,'member_removed',p_person_id);
 return 'removed';
end; $$;

create function public.tuki_delete_orphan_guest(p_person_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; guest public.persons; ref record; referenced boolean;
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 actor:=public.tuki_ensure_person();
 select * into guest from public.persons where id=p_person_id for update;
 if not found or guest.user_id is not null or guest.merged_into is not null or guest.created_by is distinct from auth.uid() then raise exception 'person_forbidden' using errcode='42501'; end if;
 if not tuki_private.removal_schema_known() then raise exception 'removal_schema_changed'; end if;
 -- Inspect every incoming FK, including future references; identifiers come
 -- only from PostgreSQL catalogs, never user input. Refuse composite FKs.
 for ref in select n.nspname,r.relname,a.attname,cardinality(c.conkey) as width
 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid
 join pg_catalog.pg_namespace n on n.oid=r.relnamespace
 join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
 where c.contype='f' and c.confrelid='public.persons'::regclass loop
   if ref.width<>1 then raise exception 'person_referenced'; end if;
   execute format('select exists(select 1 from %I.%I where %I=$1)',ref.nspname,ref.relname,ref.attname) into referenced using p_person_id;
   if referenced then raise exception 'person_referenced'; end if;
 end loop;
 delete from public.persons where id=p_person_id;
 insert into public.lifecycle_audit(actor_id,entity_type,entity_id,result) values(actor,'guest',p_person_id,'deleted');
end; $$;
revoke all on function public.tuki_delete_group(uuid,boolean),public.tuki_remove_member(uuid,uuid,boolean),public.tuki_delete_orphan_guest(uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_delete_group(uuid,boolean),public.tuki_remove_member(uuid,uuid,boolean),public.tuki_delete_orphan_guest(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
