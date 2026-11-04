begin;
create table public.bank_accounts (
 id uuid primary key, person_id uuid not null references public.persons(id),
 bank text not null check(bank in ('Itaú','Santander','BROU','Prex','OCA Blue','Otro')),
 holder text not null check(char_length(btrim(holder)) between 2 and 120),
 identifier text not null check(char_length(btrim(identifier)) between 3 and 80 and identifier !~ '[[:cntrl:]]'),
 currency text not null check(currency in ('UYU','USD')),
 alias text not null default '' check(char_length(alias)<=60), is_default boolean not null default false
);
create unique index bank_accounts_default_currency on public.bank_accounts(person_id,currency) where is_default;
alter table public.bank_accounts enable row level security;
revoke all on public.bank_accounts from anon,authenticated;
grant select on public.bank_accounts to authenticated;
create policy bank_owner_read on public.bank_accounts for select to authenticated using(person_id=tuki_private.current_person());

create function public.tuki_save_bank_account(p_id uuid,p_data jsonb,p_delete boolean default false) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 if exists(select 1 from public.bank_accounts where id=p_id and person_id<>actor) then raise exception 'payment_forbidden' using errcode='42501';end if;
 if p_delete then delete from public.bank_accounts where id=p_id and person_id=actor;return;end if;
 if coalesce((p_data->>'is_default')::boolean,false) then
 update public.bank_accounts set is_default=false where person_id=actor and currency=p_data->>'currency';end if;
 insert into public.bank_accounts(id,person_id,bank,holder,identifier,currency,alias,is_default)
 values(p_id,actor,p_data->>'bank',btrim(p_data->>'holder'),btrim(p_data->>'identifier'),p_data->>'currency',btrim(coalesce(p_data->>'alias','')),coalesce((p_data->>'is_default')::boolean,false))
 on conflict(id) do update set bank=excluded.bank,holder=excluded.holder,identifier=excluded.identifier,currency=excluded.currency,alias=excluded.alias,is_default=excluded.is_default;
end;$$;

-- Recipient details are fetched only on demand by the actual debtor. Group
-- administrators and unrelated members receive no additional bank privileges.
create function public.tuki_recipient_bank_accounts(p_receiver uuid,p_currency text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;result jsonb;
begin
 actor:=public.tuki_ensure_person();
 if p_currency is distinct from 'UYU' or actor=p_receiver or tuki_private.pair_balance(actor,p_receiver,null)<=0 then raise exception 'payment_forbidden' using errcode='42501';end if;
 select coalesce(jsonb_agg(to_jsonb(a)-'person_id' order by a.is_default desc,a.id),'[]') into result from public.bank_accounts a where a.person_id=p_receiver and a.currency=p_currency;
 return result;
end;$$;

alter table public.payments add column bank_account_id uuid references public.bank_accounts(id) on delete set null;
-- Guard the existing engine inside the same finance lock and transaction.
-- The existing intent protocol retains retry hashes and recovery semantics.
alter function tuki_private.create_payment_phase9(uuid,jsonb,boolean) rename to create_payment_before_bank;
create function tuki_private.create_payment_phase9(p_id uuid,p_data jsonb,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid;receiver uuid;account uuid;result uuid;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 if (p_data ? 'bankAccountId' or p_data->>'bankTransfer'='true') and not exists(select 1 from public.payments where id=p_id) then
 receiver:=(p_data->>'receiverId')::uuid;account:=(p_data->>'bankAccountId')::uuid;
 if actor is distinct from (p_data->>'payerId')::uuid or p_data->>'method' is distinct from 'bank'
 or coalesce((p_data->>'received')::boolean,false) or coalesce((p_data->>'administrative')::boolean,false)
 or (p_data ? 'bankAccountId' and not exists(select 1 from public.bank_accounts where id=account and person_id=receiver and currency='UYU')) then raise exception 'payment_forbidden' using errcode='42501';end if;
 if exists(select 1 from public.payments where payer_id=actor and receiver_id=receiver and status='pending') then raise exception 'payment_bank_pending';end if;
 end if;
 result:=tuki_private.create_payment_before_bank(p_id,p_data,p_confirm);
 if p_data ? 'bankAccountId' then update public.payments set bank_account_id=coalesce(bank_account_id,(select id from public.bank_accounts where id=(p_data->>'bankAccountId')::uuid)) where id=result;end if;
 return result;
end;$$;
revoke all on function tuki_private.create_payment_before_bank(uuid,jsonb,boolean),tuki_private.create_payment_phase9(uuid,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.tuki_save_bank_account(uuid,jsonb,boolean),public.tuki_recipient_bank_accounts(uuid,text) from public,anon,authenticated;
grant execute on function public.tuki_save_bank_account(uuid,jsonb,boolean),public.tuki_recipient_bank_accounts(uuid,text) to authenticated;
-- Preserve durable recovery for a duplicate bank request.
create or replace function public.tuki_submit_prepared_payment(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare operation tuki_private.payment_operations;safe_code text;
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into operation from tuki_private.payment_operations where id=p_id and user_id=auth.uid() for update;
 if not found or operation.state='cancelled' then raise exception 'operation_unavailable' using errcode='42501';end if;
 if operation.state in('processed','rejected') then return tuki_private.operation_result(operation);end if;
 if operation.acknowledged_at is not null then raise exception 'operation_unavailable' using errcode='42501';end if;
 begin
  perform tuki_private.create_payment_phase9(operation.id,operation.payload,true);
  update tuki_private.payment_operations set state='processed',error_code=null where id=p_id;
 exception when others then
  -- A subtransaction rolls back ALL financial changes before persisting a
  -- definitive safe rejection. Unknown infrastructure failures are rethrown;
  -- callers must reconcile the same ID, never create a replacement blindly.
  safe_code:=sqlerrm;
  if safe_code in('payment_forbidden','payment_admin_not_allowed','payment_confirmation_mode','payment_invalid_parties','payment_over_amount','payment_not_assignable','payment_bank_pending','payment_selection_changed','payment_reason_required','payment_guest_origin_required','invalid_decimal','invalid_receipt','payment_idempotency_conflict','group_forbidden','authentication_required') or sqlstate in('22003','22007','22P02','23502','23514') then
   if safe_code not in('payment_forbidden','payment_admin_not_allowed','payment_confirmation_mode','payment_invalid_parties','payment_over_amount','payment_not_assignable','payment_bank_pending','payment_selection_changed','payment_reason_required','payment_guest_origin_required','invalid_decimal','invalid_receipt','payment_idempotency_conflict','group_forbidden','authentication_required') then safe_code:='invalid_input';end if;
   update tuki_private.payment_operations set state='rejected',error_code=safe_code where id=p_id;
  else raise;end if;
 end;
 select * into operation from tuki_private.payment_operations where id=p_id;
 return tuki_private.operation_result(operation);
end; $$;
commit;
