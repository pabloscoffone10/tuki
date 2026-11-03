-- Block 2: optional additional explanation, without changing the payment engine.
-- Apply once AFTER 001-011. No amounts, allocations, history or permissions rewritten.
begin;
do $$ begin
 if pg_catalog.to_regclass('tuki_private.scan_jobs') is null
 or pg_catalog.to_regprocedure('public.tuki_prepare_payment(uuid,jsonb,boolean)') is null then raise exception 'block1_required';end if;
end $$;

-- Keep an automatic audit statement even when no additional explanation is given.
-- Preserve existing >=8-character strings verbatim for historical idempotency hashes.
create function tuki_private.optional_admin_reason(reason text) returns text
language sql immutable set search_path='' as $$
 select case when nullif(btrim(reason),'') is null then 'Confirmación administrativa registrada sin motivo adicional.'
 when char_length(btrim(reason))<8 then 'Motivo indicado: '||btrim(reason)
 else reason end
$$;
revoke all on function tuki_private.optional_admin_reason(text) from public,anon,authenticated;

alter function public.tuki_prepare_payment(uuid,jsonb,boolean) set schema tuki_private;
alter function tuki_private.tuki_prepare_payment(uuid,jsonb,boolean) rename to prepare_payment_block1;
revoke all on function tuki_private.prepare_payment_block1(uuid,jsonb,boolean) from public,anon,authenticated;
create function public.tuki_prepare_payment(p_id uuid,p_data jsonb,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();perform tuki_private.lock_finance();
 -- An already-recorded pre-upgrade intent must retain its original digest and
 -- outcome. Previously invalid intents are not silently converted into payments.
 if exists(select 1 from tuki_private.payment_operations where id=p_id and user_id=auth.uid()
  and request_hash=encode(sha256(convert_to(p_data::text,'UTF8')),'hex')) then
  return tuki_private.prepare_payment_block1(p_id,p_data,p_confirm);
 end if;
 if p_data->>'administrative'='true' then
  if p_data ? 'administrativeReason' and jsonb_typeof(p_data->'administrativeReason') not in('string','null') then raise exception 'payment_reason_required';end if;
  p_data:=jsonb_set(p_data,'{administrativeReason}',to_jsonb(tuki_private.optional_admin_reason(p_data->>'administrativeReason')));
 end if;
 return tuki_private.prepare_payment_block1(p_id,p_data,p_confirm);
end; $$;
revoke all on function public.tuki_prepare_payment(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.tuki_prepare_payment(uuid,jsonb,boolean) to authenticated;

alter function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) set schema tuki_private;
alter function tuki_private.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) rename to transition_payment_block1;
revoke all on function tuki_private.transition_payment_block1(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
create function public.tuki_transition_payment(p_id uuid,p_version integer,p_action text,p_reason text,p_request_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid;payment public.payments;
begin
 actor:=public.tuki_ensure_person();perform tuki_private.lock_finance();
 select * into payment from public.payments where id=p_id;
 -- Normalize only an authorized administrative confirmation. Personal receipt,
 -- rejection, voiding and every original permission/version check stay unchanged.
 if p_action='confirm' and (
  (actor<>payment.receiver_id and payment.scope='group'
   and tuki_private.can_admin_payment(payment.payer_id,payment.receiver_id,payment.group_id))
  -- Replaying an already committed event is not new authority. Preserve its
  -- normalized digest after role loss; the original engine still checks actor,
  -- request hash and arguments before returning the idempotent result.
  or exists(select 1 from public.payment_events e where e.id=p_request_id
   and e.payment_id=p_id and e.actor_id=actor and e.action='confirm' and e.administrative)
 ) then
  p_reason:=tuki_private.optional_admin_reason(p_reason);
 end if;
 perform tuki_private.transition_payment_block1(p_id,p_version,p_action,p_reason,p_request_id,p_confirm);
end; $$;
revoke all on function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) from public,anon,authenticated;
grant execute on function public.tuki_transition_payment(uuid,integer,text,text,uuid,boolean) to authenticated;

-- Capability metadata is added to existing responses; no new browser query,
-- financial projection, data grant or private identity discovery is introduced.
alter function public.tuki_payment_workspace(uuid) set schema tuki_private;
alter function tuki_private.tuki_payment_workspace(uuid) rename to payment_workspace_block1;
revoke all on function tuki_private.payment_workspace_block1(uuid) from public,anon,authenticated;
create function public.tuki_payment_workspace(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 return tuki_private.payment_workspace_block1(p_group_id)||jsonb_build_object('optional_admin_reason',true);
end; $$;
revoke all on function public.tuki_payment_workspace(uuid) from public,anon,authenticated;
grant execute on function public.tuki_payment_workspace(uuid) to authenticated;

alter function public.tuki_notification_inbox() set schema tuki_private;
alter function tuki_private.tuki_notification_inbox() rename to notification_inbox_block1;
revoke all on function tuki_private.notification_inbox_block1() from public,anon,authenticated;
create function public.tuki_notification_inbox() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 result:=tuki_private.notification_inbox_block1();
 return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('optional_admin_reason',true)) from jsonb_array_elements(result->'items') item),'[]'))
  ||jsonb_build_object('optional_admin_reason',true);
end; $$;
revoke all on function public.tuki_notification_inbox() from public,anon,authenticated;
grant execute on function public.tuki_notification_inbox() to authenticated;
notify pgrst,'reload schema';
commit;
