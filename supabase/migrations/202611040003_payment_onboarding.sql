begin;
-- Existing accounts are not interrupted. Only profiles created after activation
-- receive the one-time optional welcome, regardless of their Auth provider.
alter table public.profiles add column payment_onboarding_state text not null default 'done'
 check(payment_onboarding_state in ('pending','offered','done'));
alter table public.profiles alter column payment_onboarding_state set default 'pending';

create function public.tuki_offer_payment_onboarding() returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then return false;end if;
 update public.profiles set payment_onboarding_state='offered'
 where user_id=auth.uid() and payment_onboarding_state='pending';
 return found;
end;$$;
create function public.tuki_finish_payment_onboarding() returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'authentication_required' using errcode='42501';end if;
 update public.profiles set payment_onboarding_state='done' where user_id=auth.uid();
end;$$;
revoke all on function public.tuki_offer_payment_onboarding(),public.tuki_finish_payment_onboarding() from public,anon,authenticated;
grant execute on function public.tuki_offer_payment_onboarding(),public.tuki_finish_payment_onboarding() to authenticated;
notify pgrst,'reload schema';
commit;
