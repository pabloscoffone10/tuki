-- Phase 2 only: account profiles, not global persons or guest identities.
-- Apply once to the intended project, inside the Supabase SQL Editor.
begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated
  using ((select auth.uid()) = user_id);
create policy profiles_update_own on public.profiles for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create function public.tuki_create_account_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', ''), 80));
  return new;
end;
$$;

revoke all on function public.tuki_create_account_profile() from public, anon, authenticated;
create trigger tuki_auth_user_created after insert on auth.users
  for each row execute function public.tuki_create_account_profile();

-- Backfill existing accounts; do not modify or delete existing Auth users.
insert into public.profiles (user_id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name', ''), 80)
from auth.users on conflict (user_id) do nothing;

comment on table public.profiles is 'Tuki account profiles; future global persons and guests are separate domain identities.';
commit;
