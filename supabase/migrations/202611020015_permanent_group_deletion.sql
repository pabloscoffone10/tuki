-- Apply once after 001-014. Explicit owner deletion; no shared identity deletion.
begin;
do $$ begin
 if pg_catalog.to_regprocedure('public.tuki_personal_statistics(date,date)') is null
 or pg_catalog.to_regclass('tuki_private.payment_operations') is null then raise exception 'previous_migrations_required'; end if;
end $$;

-- Storage bytes require the Storage API. Commit a durable cleanup request with
-- the database deletion; never delete storage.objects directly from SQL.
create table tuki_private.group_file_deletions (
 group_id uuid not null, path text not null, primary key(group_id,path),
 check(path like group_id::text||'/%')
);
revoke all on tuki_private.group_file_deletions from public,anon,authenticated;

create or replace function public.tuki_delete_group(p_group_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare actor uuid; owner uuid; payment_ids uuid[]; obligation_ids uuid[];
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 actor:=public.tuki_ensure_person(); perform tuki_private.lock_finance();
 select created_by into owner from public.groups where id=p_group_id for update;
 if not found then
  if exists(select 1 from public.lifecycle_audit where entity_type='group' and entity_id=p_group_id and actor_id=actor and result='deleted') then return; end if;
  raise exception 'group_owner_required' using errcode='42501';
 end if;
 if owner<>actor or not tuki_private.is_member(p_group_id) then raise exception 'group_owner_required' using errcode='42501'; end if;
 if not tuki_private.removal_schema_known() then raise exception 'removal_schema_changed'; end if;
 -- Unknown cascades in other schemas must not silently erase shared domain data.
 if exists(select 1 from pg_catalog.pg_constraint c where c.contype='f'
  and c.confrelid=any(array['public.groups'::regclass,'public.group_members'::regclass,'public.group_invitations'::regclass,'public.group_events'::regclass,
   'public.expenses'::regclass,'public.expense_revisions'::regclass,'public.expense_shares'::regclass,'public.expense_people_history'::regclass,
   'public.obligations'::regclass,'public.expense_events'::regclass,'public.payments'::regclass,'public.payment_allocations'::regclass,
   'public.payment_events'::regclass,'public.ticket_uploads'::regclass,'public.smart_bill_revisions'::regclass])
  and c.conrelid<>all(array['public.groups'::regclass,'public.group_members'::regclass,'public.group_invitations'::regclass,'public.group_events'::regclass,
   'public.expenses'::regclass,'public.expense_revisions'::regclass,'public.expense_shares'::regclass,'public.expense_people_history'::regclass,
   'public.obligations'::regclass,'public.expense_events'::regclass,'public.payments'::regclass,'public.payment_allocations'::regclass,
   'public.payment_events'::regclass,'public.ticket_uploads'::regclass,'public.smart_bill_revisions'::regclass,
   'tuki_private.notification_outbox'::regclass,'tuki_private.scan_jobs'::regclass])) then raise exception 'removal_schema_changed'; end if;
 select coalesce(array_agg(id),'{}') into obligation_ids from public.obligations where group_id=p_group_id;
 select coalesce(array_agg(p.id),'{}') into payment_ids from public.payments p where p.group_id=p_group_id
  or p.selected_obligations && obligation_ids
  or exists(select 1 from public.payment_allocations a where a.payment_id=p.id and a.obligation_id=any(obligation_ids));
 -- A global payment can be removed only when all of its origins are this group.
 -- Historical/reversed allocations are references too; never rewrite a payment.
 if exists(select 1 from public.payments p where p.id=any(payment_ids) and
  ((p.group_id is not null and p.group_id<>p_group_id)
   or exists(select 1 from public.payment_allocations a join public.obligations o on o.id=a.obligation_id where a.payment_id=p.id and o.group_id<>p_group_id)
   or exists(select 1 from unnest(p.selected_obligations) s where not(s=any(obligation_ids)))))
  or exists(select 1 from tuki_private.payment_operations op where op.payload is not null
   and (op.payload->>'groupId'=p_group_id::text or op.id=any(payment_ids)
    or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected')='array' then op.payload->'selected' else '[]'::jsonb end) s where s=any(select id::text from public.obligations where group_id=p_group_id)))
   and ((nullif(op.payload->>'groupId','') is not null and op.payload->>'groupId'<>p_group_id::text)
    or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected')='array' then op.payload->'selected' else '[]'::jsonb end) s where not(s=any(select id::text from public.obligations where group_id=p_group_id)))))
  or exists(select 1 from public.smart_bill_revisions s join public.ticket_uploads u on u.id=s.upload_id where u.group_id=p_group_id and s.group_id<>p_group_id)
 then raise exception 'group_shared_financial_history'; end if;

 insert into tuki_private.group_file_deletions(group_id,path)
 select p_group_id,path from public.ticket_uploads where group_id=p_group_id on conflict do nothing;
 -- Keep only idempotency tombstones: an old browser intent cannot recreate data.
 update tuki_private.payment_operations op set state='cancelled',payload=null,error_code=null,acknowledged_at=clock_timestamp()
 where op.id=any(payment_ids) or op.payload->>'groupId'=p_group_id::text
  or exists(select 1 from jsonb_array_elements_text(case when jsonb_typeof(op.payload->'selected')='array' then op.payload->'selected' else '[]'::jsonb end) s where s=any(select id::text from public.obligations where group_id=p_group_id));
 delete from public.notifications n where exists(select 1 from tuki_private.notification_outbox o
  where o.user_id=n.user_id and o.event_key=n.event_key and (o.group_id=p_group_id or o.payment_id=any(payment_ids)
   or o.expense_id in(select id from public.expenses where group_id=p_group_id)))
  or n.href='/grupos/'||p_group_id::text
  or n.href in(select '/gastos/'||id::text from public.expenses where group_id=p_group_id)
  or n.href in(select '/pagos#pago-'||unnest(payment_ids)::text);
 delete from tuki_private.notification_outbox where group_id=p_group_id or payment_id=any(payment_ids)
  or expense_id in(select id from public.expenses where group_id=p_group_id);
 delete from public.payment_events where payment_id=any(payment_ids);
 delete from public.payment_allocations where payment_id=any(payment_ids);
 delete from public.payments where id=any(payment_ids);
 delete from public.smart_bill_revisions where group_id=p_group_id;
 delete from public.ticket_uploads where group_id=p_group_id;
 delete from tuki_private.scan_jobs where group_id=p_group_id;
 delete from public.obligations where group_id=p_group_id;
 delete from public.expense_shares where revision_id in(select id from public.expense_revisions where group_id=p_group_id);
 delete from public.expense_people_history where group_id=p_group_id;
 delete from public.expense_events where group_id=p_group_id;
 delete from public.expense_revisions where group_id=p_group_id;
 delete from public.expenses where group_id=p_group_id;
 delete from public.group_events where group_id=p_group_id;
 delete from public.group_invitations where group_id=p_group_id;
 delete from public.group_members where group_id=p_group_id;
 delete from public.groups where id=p_group_id;
 insert into public.lifecycle_audit(actor_id,entity_type,entity_id,result) values(actor,'group',p_group_id,'deleted');
end; $$;

create function public.tuki_delete_member(p_group_id uuid,p_person_id uuid,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare target public.group_members;
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 perform public.tuki_ensure_person(); perform tuki_private.lock_finance(); perform tuki_private.lock_admin(p_group_id,true);
 if not tuki_private.removal_schema_known() then raise exception 'removal_schema_changed'; end if;
 select * into target from public.group_members where group_id=p_group_id and person_id=p_person_id for update;
 if not found then raise exception 'person_forbidden' using errcode='42501'; end if;
 if target.role='admin' and target.status='active' and (select count(*) from public.group_members where group_id=p_group_id and role='admin' and status='active')<=1 then raise exception 'last_admin'; end if;
 if exists(select 1 from public.groups where id=p_group_id and created_by=p_person_id) then raise exception 'group_owner_cannot_remove'; end if;
 if target.replaced_by_person_id is not null or exists(select 1 from public.group_members where group_id=p_group_id and replaced_by_person_id=p_person_id)
 then raise exception 'member_replacement_history'; end if;
 if exists(select 1 from public.expense_people_history where group_id=p_group_id and person_id=p_person_id)
  or exists(select 1 from public.expense_revisions where group_id=p_group_id and payer_id=p_person_id)
  or exists(select 1 from public.expense_shares s join public.expense_revisions r on r.id=s.revision_id where r.group_id=p_group_id and s.person_id=p_person_id)
  or exists(select 1 from public.payments p where p_person_id in(p.payer_id,p.receiver_id,p.created_by,p.approver_id,p.confirmed_by)
   and (p.group_id=p_group_id or exists(select 1 from public.payment_allocations a join public.obligations o on o.id=a.obligation_id where a.payment_id=p.id and o.group_id=p_group_id)
    or exists(select 1 from public.obligations o where o.id=any(p.selected_obligations) and o.group_id=p_group_id)
    or (target.status='active' and p_person_id in(p.payer_id,p.receiver_id)
     and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.status='active' and m.person_id=case when p.payer_id=p_person_id then p.receiver_id else p.payer_id end))))
  or exists(select 1 from tuki_private.payment_operations where state='prepared' and payload->>'groupId'=p_group_id::text and p_person_id::text in(payload->>'payerId',payload->>'receiverId'))
 then raise exception 'member_financial_history'; end if;
 if target.status='active' and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.status='active' and m.person_id<>p_person_id
  and tuki_private.pair_balance(p_person_id,m.person_id,null)<>0) then raise exception 'member_pending_balance'; end if;
 -- Administrative events refer to the retained global identity, not membership.
 -- No person is deleted: it may belong to another group or retain audit history.
 delete from public.group_members where group_id=p_group_id and person_id=p_person_id;
 perform tuki_private.event(p_group_id,'member_removed',p_person_id);
end; $$;

create function public.tuki_group_deletion_status(p_group_id uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.lifecycle_audit where entity_type='group' and entity_id=p_group_id and actor_id=public.tuki_ensure_person() and result='deleted') then raise exception 'group_owner_required' using errcode='42501'; end if;
 return (select count(*)::integer from tuki_private.group_file_deletions where group_id=p_group_id);
end; $$;

-- Only trusted server code can enumerate paths; ACK only after Storage removed
-- object metadata through its API. Retries after a crash are safe.
create function public.tuki_group_file_cleanup(p_group_id uuid,p_removed text[] default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 delete from tuki_private.group_file_deletions q where q.group_id=p_group_id and q.path=any(p_removed)
  and not exists(select 1 from storage.objects o where o.bucket_id='tuki-tickets' and o.name=q.path);
 return jsonb_build_object('remaining',(select count(*) from tuki_private.group_file_deletions where group_id=p_group_id),
  'paths',coalesce((select jsonb_agg(path) from(select path from tuki_private.group_file_deletions where group_id=p_group_id order by path limit 100) batch),'[]'));
end; $$;
revoke all on function public.tuki_delete_group(uuid,boolean),public.tuki_delete_member(uuid,uuid,boolean),public.tuki_group_deletion_status(uuid),public.tuki_group_file_cleanup(uuid,text[]) from public,anon,authenticated;
grant execute on function public.tuki_delete_group(uuid,boolean),public.tuki_delete_member(uuid,uuid,boolean),public.tuki_group_deletion_status(uuid) to authenticated;
grant execute on function public.tuki_group_file_cleanup(uuid,text[]) to service_role;
notify pgrst,'reload schema';
commit;
