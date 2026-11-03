-- OWNER-ONLY diagnostic. Run in BEGIN TRANSACTION READ ONLY; ... COMMIT;
-- Not a migration, RPC, repair or proof that files physically exist in Storage.
-- Zero rows means no violations of THESE checks at this snapshot, not a full audit.
-- Equal amounts/parties on DISTINCT payment IDs are not proof of duplication.
-- Minor-unit checks also help validate an unconstrained or incomplete restore.
with allocation_totals as (
 select payment_id,sum(amount_minor) total,
   coalesce(sum(amount_minor) filter(where reversed_at is null),0) live
 from public.payment_allocations group by payment_id
), paid_obligations as (
 select a.obligation_id,sum(a.amount_minor) total from public.payment_allocations a
 join public.payments p on p.id=a.payment_id
 where p.status='confirmed' and a.reversed_at is null group by a.obligation_id
), violations as (
 select 'confirmed_payment_allocation_mismatch' issue,p.id entity_id,
   jsonb_build_object('expected_minor',p.amount_minor::text,'allocated_minor',coalesce(t.live,0)::text) details
 from public.payments p left join allocation_totals t on t.payment_id=p.id
 where p.status='confirmed' and coalesce(t.live,0)<>p.amount_minor
 union all
 select 'unconfirmed_payment_live_allocation',p.id,jsonb_build_object('status',p.status,'live_minor',t.live::text)
 from public.payments p join allocation_totals t on t.payment_id=p.id where p.status<>'confirmed' and t.live<>0
 union all
 select 'pending_or_rejected_payment_has_allocations',p.id,jsonb_build_object('status',p.status)
 from public.payments p join allocation_totals t on t.payment_id=p.id where p.status in('pending','rejected') and t.total<>0
 union all
 select 'payment_allocations_exceed_amount',p.id,jsonb_build_object('expected_minor',p.amount_minor::text,'allocated_minor',t.total::text)
 from public.payments p join allocation_totals t on t.payment_id=p.id where t.total>p.amount_minor
 union all
 select 'obligation_overallocated',o.id,jsonb_build_object('original_minor',o.amount_minor::text,'paid_minor',a.total::text)
 from public.obligations o join paid_obligations a on a.obligation_id=o.id where a.total>o.amount_minor
 union all
 select 'allocation_parties_or_scope_mismatch',a.payment_id,jsonb_build_object('obligation_id',a.obligation_id)
 from public.payment_allocations a join public.payments p on p.id=a.payment_id join public.obligations o on o.id=a.obligation_id
 where p.payer_id<>o.debtor_id or p.receiver_id<>o.creditor_id or(p.scope='group' and p.group_id is distinct from o.group_id)
 union all
 select 'confirmed_payment_inactive_obligation',a.payment_id,jsonb_build_object('obligation_id',a.obligation_id)
 from public.payment_allocations a join public.payments p on p.id=a.payment_id join public.obligations o on o.id=a.obligation_id
 where p.status='confirmed' and a.reversed_at is null and not o.active
 union all
 select 'allocation_reversal_pair_mismatch',a.payment_id,jsonb_build_object('obligation_id',a.obligation_id)
 from public.payment_allocations a where (a.reversed_at is null)<>(a.reversed_by is null)
 union all
 select 'payment_confirmation_metadata_missing',p.id,jsonb_build_object('status',p.status)
 from public.payments p where(p.status='confirmed' and(p.confirmed_at is null or p.confirmed_by is null or p.approval_mode is null))
  or((p.confirmed_at is null)<>(p.confirmed_by is null))
 union all
 select 'expense_revision_share_mismatch',r.id,jsonb_build_object('expected_minor',r.total_minor::text,'shares_minor',coalesce(sum(s.amount_minor),0)::text)
 from public.expense_revisions r left join public.expense_shares s on s.revision_id=r.id
 group by r.id,r.total_minor having coalesce(sum(s.amount_minor),0)<>r.total_minor
 union all
 select 'active_obligation_revision_mismatch',o.id,jsonb_build_object('expense_id',o.expense_id)
 from public.obligations o join public.expenses e on e.id=o.expense_id join public.expense_revisions r on r.id=o.revision_id
 where o.active and(e.status<>'active' or e.version<>r.version or e.group_id<>o.group_id or r.expense_id<>e.id)
 union all
 select 'expense_current_revision_missing',e.id,jsonb_build_object('version',e.version)
 from public.expenses e where not exists(select 1 from public.expense_revisions r where r.expense_id=e.id and r.version=e.version)
 union all
 select 'allocation_reference_missing',a.payment_id,jsonb_build_object('obligation_id',a.obligation_id)
 from public.payment_allocations a left join public.payments p on p.id=a.payment_id left join public.obligations o on o.id=a.obligation_id
 where p.id is null or o.id is null
 union all
 select 'obligation_reference_missing',o.id,jsonb_build_object('expense_id',o.expense_id,'revision_id',o.revision_id)
 from public.obligations o left join public.expenses e on e.id=o.expense_id
 left join public.expense_revisions r on r.id=o.revision_id left join public.groups g on g.id=o.group_id
 left join public.persons d on d.id=o.debtor_id left join public.persons c on c.id=o.creditor_id
 where e.id is null or r.id is null or g.id is null or d.id is null or c.id is null
 union all
 select 'payment_reference_missing',p.id,jsonb_build_object('group_id',p.group_id)
 from public.payments p left join public.persons d on d.id=p.payer_id left join public.persons c on c.id=p.receiver_id
 left join public.persons confirmer on confirmer.id=p.confirmed_by left join public.groups g on g.id=p.group_id
 where d.id is null or c.id is null or(p.confirmed_by is not null and confirmer.id is null)or(p.group_id is not null and g.id is null)
 union all
 select 'expense_revision_reference_missing',r.id,jsonb_build_object('expense_id',r.expense_id,'group_id',r.group_id,'payer_id',r.payer_id)
 from public.expense_revisions r left join public.expenses e on e.id=r.expense_id
 left join public.groups g on g.id=r.group_id left join public.persons p on p.id=r.payer_id
 where e.id is null or g.id is null or p.id is null
 union all
 select 'expense_share_reference_missing',s.revision_id,jsonb_build_object('person_id',s.person_id)
 from public.expense_shares s left join public.expense_revisions r on r.id=s.revision_id left join public.persons p on p.id=s.person_id
 where r.id is null or p.id is null
 union all
 select 'obligation_share_mismatch',o.id,jsonb_build_object('revision_id',o.revision_id)
 from public.obligations o join public.expense_revisions r on r.id=o.revision_id
 left join public.expense_shares s on s.revision_id=o.revision_id and s.person_id=o.debtor_id
 where s.person_id is null or s.amount_minor<>o.amount_minor or r.payer_id<>o.creditor_id or r.group_id<>o.group_id
 union all
 select 'expense_share_obligation_missing',r.id,jsonb_build_object('person_id',s.person_id)
 from public.expense_revisions r join public.expense_shares s on s.revision_id=r.id
 where s.amount_minor>0 and s.person_id<>r.payer_id and not exists(select 1 from public.obligations o where o.revision_id=r.id and o.debtor_id=s.person_id)
 union all
 select 'current_share_active_obligation_missing',r.id,jsonb_build_object('expense_id',e.id,'person_id',s.person_id)
 from public.expenses e join public.expense_revisions r on r.expense_id=e.id and r.version=e.version
 join public.expense_shares s on s.revision_id=r.id
 where e.status='active' and s.amount_minor>0 and s.person_id<>r.payer_id
 and not exists(select 1 from public.obligations o where o.revision_id=r.id and o.debtor_id=s.person_id and o.active)
 union all
 select 'financial_minor_invalid',p.id,jsonb_build_object('entity','payment','amount_minor',p.amount_minor::text)
 from public.payments p where p.amount_minor is null or p.amount_minor<=0 or p.amount_minor<>trunc(p.amount_minor) or p.amount_minor::text in ('NaN','Infinity','-Infinity')
 union all
 select 'financial_minor_invalid',a.payment_id,jsonb_build_object('entity','allocation','obligation_id',a.obligation_id,'amount_minor',a.amount_minor::text)
 from public.payment_allocations a where a.amount_minor is null or a.amount_minor<=0 or a.amount_minor<>trunc(a.amount_minor) or a.amount_minor::text in ('NaN','Infinity','-Infinity')
 union all
 select 'financial_minor_invalid',o.id,jsonb_build_object('entity','obligation','amount_minor',o.amount_minor::text)
 from public.obligations o where o.amount_minor is null or o.amount_minor<=0 or o.amount_minor<>trunc(o.amount_minor) or o.amount_minor::text in ('NaN','Infinity','-Infinity')
 union all
 select 'financial_minor_invalid',r.id,jsonb_build_object('entity','expense_revision','total_minor',r.total_minor::text)
 from public.expense_revisions r where r.total_minor is null or r.total_minor<=0 or r.total_minor<>trunc(r.total_minor) or r.total_minor::text in ('NaN','Infinity','-Infinity')
 union all
 select 'financial_minor_invalid',s.revision_id,jsonb_build_object('entity','expense_share','person_id',s.person_id,'amount_minor',s.amount_minor::text)
 from public.expense_shares s where s.amount_minor is null or s.amount_minor<0 or s.amount_minor<>trunc(s.amount_minor) or s.amount_minor::text in ('NaN','Infinity','-Infinity')
 union all
 select 'duplicate_financial_event',payment_id,jsonb_build_object('action',action,'count',count(*)::text)
 from public.payment_events where action in('created','confirm') group by payment_id,action having count(*)>1
 union all
 select 'payment_audit_event_missing',p.id,jsonb_build_object('status',p.status)
 from public.payments p where not exists(select 1 from public.payment_events e where e.payment_id=p.id and e.action='created')
 or(p.confirmed_by is not null and not exists(select 1 from public.payment_events e where e.payment_id=p.id and e.action='confirm'))
 union all
 select 'payment_terminal_audit_event_missing',p.id,jsonb_build_object('status',p.status)
 from public.payments p where (p.status='rejected' and not exists(select 1 from public.payment_events e where e.payment_id=p.id and e.action='reject'))
 or(p.status='void' and not exists(select 1 from public.payment_events e where e.payment_id=p.id and e.action='void'))
 union all
 select 'referenced_ticket_metadata_missing',s.revision_id,jsonb_build_object('upload_id',s.upload_id)
 from public.smart_bill_revisions s left join public.ticket_uploads u on u.id=s.upload_id
 left join storage.objects o on o.bucket_id='tuki-tickets' and o.name=u.path
 where s.upload_id is not null and(u.id is null or o.id is null)
)
select issue,entity_id,details from violations order by issue,entity_id;
