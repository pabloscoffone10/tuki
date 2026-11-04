-- Reviewed extension: bank_accounts belongs to a global person, never to a group.
-- Its FK does not cascade from persons; group deletion must retain these rows.
-- Keep the unknown public table and external FK guards in place.
begin;
create or replace function tuki_private.removal_schema_known() returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions','receipt_scan_requests','payments','payment_allocations','payment_events','notifications','notification_preferences','bank_accounts'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass) and n.nspname<>'public' and not((n.nspname='tuki_private' and r.relname in('notification_outbox','reminder_log','automatic_reminder_runs')) or(n.nspname='tuki_private' and r.relname='scan_jobs' and c.confrelid='public.groups'::regclass and c.confdeltype='c')))
$$;
revoke all on function tuki_private.removal_schema_known() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
