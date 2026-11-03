-- Block 5 beta product policy: new operations use UYU only.
-- Apply once after 001-013. No remote execution or financial-row rewrite.
-- The underlying audited engine, hashes, locks, allocations and history stay intact.
begin;
do $$ begin
 if pg_catalog.to_regprocedure('public.tuki_group_statistics(uuid,date,date)') is null
 or pg_catalog.to_regprocedure('tuki_private.prepare_payment_block1(uuid,jsonb,boolean)') is null then
  raise exception 'block3_required: apply migrations 001-013 before beta UYU';
 end if;
end $$;

alter function public.tuki_save_expense(uuid,uuid,integer,jsonb) set schema tuki_private;
alter function tuki_private.tuki_save_expense(uuid,uuid,integer,jsonb) rename to save_expense_before_beta;
revoke all on function tuki_private.save_expense_before_beta(uuid,uuid,integer,jsonb) from public,anon,authenticated;

create function public.tuki_save_expense(p_id uuid,p_group_id uuid,p_expected_version integer,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;existing public.expenses;prior public.expense_revisions;document jsonb;currency text;rate numeric;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 -- Keep the existing finance -> group lock order. Verify permission before
 -- checking historical metadata; the currency policy must not reveal an expense.
 perform id from public.groups where id=p_group_id for update;
 if not found or not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501';end if;
 select * into existing from public.expenses where id=p_id;
 if existing.id is not null and(existing.group_id<>p_group_id or(p_expected_version is distinct from 0 and existing.created_by<>actor and not tuki_private.is_admin(p_group_id))) then
  raise exception 'expense_forbidden' using errcode='42501';
 end if;
 -- An old create retry is not a new expense. Let the original actor/hash check
 -- decide it, including foreign-currency requests recorded before this policy.
 if existing.id is not null and p_expected_version=0 then
  return tuki_private.save_expense_before_beta(p_id,p_group_id,p_expected_version,p_data);
 end if;
 if (existing.id is null and p_expected_version is distinct from 0)
 or(existing.id is not null and(existing.version is distinct from p_expected_version or existing.status<>'active')) then
  return tuki_private.save_expense_before_beta(p_id,p_group_id,p_expected_version,p_data);
 end if;
 document:=p_data->'smartBill';
 if document is not null and document<>'null'::jsonb then
  currency:=document->>'currency';rate:=tuki_private.decimal_units(coalesce(document->>'rate','1'),6);
 else
  currency:=p_data->>'currency';rate:=tuki_private.decimal_units(coalesce(p_data->>'rate','1'),6);
 end if;
 if existing.id is null then
  if currency is distinct from 'UYU' or rate<>1000000 then raise exception 'beta_currency_uyu_only' using errcode='22023';end if;
 else
  select * into prior from public.expense_revisions where expense_id=p_id and version=existing.version;
  if currency is distinct from prior.original_currency or rate is distinct from prior.exchange_rate*1000000 then
   raise exception 'beta_historical_currency_locked' using errcode='22023';
  end if;
 end if;
 return tuki_private.save_expense_before_beta(p_id,p_group_id,p_expected_version,p_data);
end; $$;

alter function public.tuki_prepare_payment(uuid,jsonb,boolean) set schema tuki_private;
alter function tuki_private.tuki_prepare_payment(uuid,jsonb,boolean) rename to prepare_payment_before_beta;
revoke all on function tuki_private.prepare_payment_before_beta(uuid,jsonb,boolean) from public,anon,authenticated;

create function public.tuki_prepare_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 -- Existing intents and pre-protocol payments retain their exact payload/hash.
 -- Payments have always been stored in UYU, with no foreign-currency column.
 if exists(select 1 from tuki_private.payment_operations where id=p_id and user_id=auth.uid())
 or exists(select 1 from public.payments where id=p_id and created_by=tuki_private.current_person()) then
  return tuki_private.prepare_payment_before_beta(p_id,p_data,p_confirm);
 end if;
 if (p_data ? 'currency' and p_data->>'currency' is distinct from 'UYU')
 or(p_data ? 'originalCurrency' and p_data->>'originalCurrency' is distinct from 'UYU')
 or(p_data ? 'original_currency' and p_data->>'original_currency' is distinct from 'UYU')
 or(p_data ? 'rate' and tuki_private.decimal_units(p_data->>'rate',6)<>1000000) then
  raise exception 'beta_currency_uyu_only' using errcode='22023';
 end if;
 return tuki_private.prepare_payment_before_beta(p_id,p_data,p_confirm);
end; $$;

revoke all on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_prepare_payment(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_prepare_payment(uuid,jsonb,boolean) to authenticated;
notify pgrst,'reload schema';
commit;
