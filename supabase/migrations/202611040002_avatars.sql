begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('tuki-avatars','tuki-avatars',false,524288,array['image/jpeg']) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create function tuki_private.avatar_access(path text,writing boolean) returns boolean
language plpgsql volatile security definer set search_path='' as $$
declare parts text[];target uuid;
begin
 if auth.uid() is null or path !~ '^(profile|group)/[0-9a-f-]{36}/avatar[.]jpg$' then return false;end if;
 -- Serialize object writes with membership/financial group deletion.
 if writing then perform tuki_private.lock_finance();end if;
 parts:=string_to_array(path,'/');
 begin target:=parts[2]::uuid;exception when invalid_text_representation then return false;end;
 if parts[1]='profile' then
 if target=auth.uid() then return true;end if;
 if writing then return false;end if;
 return exists(select 1 from public.persons p join public.group_members m on m.person_id=p.id
 where p.user_id=target and m.status='active' and tuki_private.is_member(m.group_id));
 end if;
 return case when writing then tuki_private.is_admin(target) and exists(select 1 from public.groups where id=target and archived_at is null) else tuki_private.is_member(target) end;
end;$$;
revoke all on function tuki_private.avatar_access(text,boolean) from public,anon,authenticated;
grant execute on function tuki_private.avatar_access(text,boolean) to authenticated;
create policy avatar_read on storage.objects for select to authenticated using(bucket_id='tuki-avatars' and tuki_private.avatar_access(name,false));
create policy avatar_insert on storage.objects for insert to authenticated with check(bucket_id='tuki-avatars' and tuki_private.avatar_access(name,true));
create policy avatar_update on storage.objects for update to authenticated using(bucket_id='tuki-avatars' and tuki_private.avatar_access(name,true)) with check(bucket_id='tuki-avatars' and tuki_private.avatar_access(name,true));
create policy avatar_delete on storage.objects for delete to authenticated using(bucket_id='tuki-avatars' and tuki_private.avatar_access(name,true));

-- Durable Storage cleanup, without touching global identities or ticket files.
create table tuki_private.avatar_deletions(group_id uuid primary key,path text not null check(path='group/'||group_id::text||'/avatar.jpg'));
revoke all on tuki_private.avatar_deletions from public,anon,authenticated;
alter function public.tuki_delete_group(uuid,boolean) set schema tuki_private;
alter function tuki_private.tuki_delete_group(uuid,boolean) rename to delete_group_before_avatar;
revoke all on function tuki_private.delete_group_before_avatar(uuid,boolean) from public,anon,authenticated;
create function public.tuki_delete_group(p_group_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform tuki_private.delete_group_before_avatar(p_group_id,p_confirm);
 if exists(select 1 from storage.objects where bucket_id='tuki-avatars' and name='group/'||p_group_id::text||'/avatar.jpg') then
 insert into tuki_private.avatar_deletions values(p_group_id,'group/'||p_group_id::text||'/avatar.jpg') on conflict do nothing;end if;
end;$$;
create or replace function public.tuki_group_deletion_status(p_group_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.lifecycle_audit where entity_type='group' and entity_id=p_group_id and actor_id=public.tuki_ensure_person() and result='deleted') then raise exception 'group_owner_required' using errcode='42501';end if;
 return (select count(*)::integer from tuki_private.group_file_deletions where group_id=p_group_id)+(select count(*)::integer from tuki_private.avatar_deletions where group_id=p_group_id);
end;$$;
create function public.tuki_avatar_cleanup(p_group_id uuid,p_ack boolean default false) returns text
language plpgsql security definer set search_path='' as $$
begin
 if p_ack then delete from tuki_private.avatar_deletions q where q.group_id=p_group_id and not exists(select 1 from storage.objects where bucket_id='tuki-avatars' and name=q.path);end if;
 return (select path from tuki_private.avatar_deletions where group_id=p_group_id);
end;$$;
revoke all on function public.tuki_delete_group(uuid,boolean),public.tuki_avatar_cleanup(uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_delete_group(uuid,boolean) to authenticated;
grant execute on function public.tuki_avatar_cleanup(uuid,boolean) to service_role;
notify pgrst,'reload schema';
commit;
