-- Block 3: read-only origin reports. Apply once after 001-012.
-- No financial mutation, obligation projection, ledger rewrite or new RLS grant.
begin;
do $$ begin
 if pg_catalog.to_regprocedure('tuki_private.notification_inbox_block1()') is null then raise exception 'block2_required';end if;
end $$;

create function tuki_private.report_guard(g uuid,f date,t date) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or tuki_private.current_person() is null or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'authentication_required' using errcode='42501';end if;
 if g is not null and not tuki_private.is_member(g) then raise exception 'group_forbidden' using errcode='42501';end if;
 if (f is not null and (f<'1900-01-01'::date or f>'2100-12-31'::date)) or (t is not null and (t<'1900-01-01'::date or t>'2100-12-31'::date)) or(f is not null and t is not null and f>t) then raise exception 'invalid_report_period' using errcode='22023';end if;
end; $$;
revoke all on function tuki_private.report_guard(uuid,date,date) from public,anon,authenticated;

-- No private receipt, notes or document bytes enter this reporting projection.
create view tuki_private.report_expenses as
 select e.id,e.group_id,g.name group_name,e.status,e.version,e.created_at,r.id revision_id,
 r.title,r.category,r.expense_date,r.payer_id,r.original_currency currency,r.original_minor,
 r.exchange_rate rate,r.total_minor,r.split_method method
 from public.expenses e join public.expense_revisions r on r.expense_id=e.id and r.version=e.version
 join public.groups g on g.id=e.group_id;
revoke all on tuki_private.report_expenses from public,anon,authenticated;

create function public.tuki_group_statistics(p_group_id uuid,p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if p_group_id is null then raise exception 'group_forbidden' using errcode='42501';end if;
 perform tuki_private.report_guard(p_group_id,p_from,p_to);
 with chosen as materialized(select * from tuki_private.report_expenses where group_id=p_group_id and status='active' and(p_from is null or expense_date>=p_from) and(p_to is null or expense_date<=p_to)),
 allocations as materialized(select a.*,p.payer_id,p.receiver_id from public.payment_allocations a join public.payments p on p.id=a.payment_id
  join public.obligations o on o.id=a.obligation_id join chosen c on c.revision_id=o.revision_id where p.status='confirmed' and a.reversed_at is null),
 ledger as(select payer_id person_id,total_minor advanced,0::numeric consumed,0::numeric paid,0::numeric received from chosen
  union all select s.person_id,0,s.amount_minor,0,0 from chosen c join public.expense_shares s on s.revision_id=c.revision_id
  union all select payer_id,0,0,amount_minor,0 from allocations
  union all select receiver_id,0,0,0,amount_minor from allocations)
 select jsonb_build_object('group_id',p_group_id,'group_name',(select name from public.groups where id=p_group_id),
 'from',p_from,'to',p_to,'currency','UYU','expense_count',(select count(*) from chosen),
 'total_minor',coalesce((select sum(total_minor) from chosen),0)::text,
 'confirmed_minor',coalesce((select sum(amount_minor) from allocations),0)::text,
 'outstanding_minor',coalesce((select sum(o.remaining_minor) from tuki_private.open_obligations o join chosen c on c.revision_id=o.revision_id where o.active),0)::text,
 -- A pending global payment without allocations has no provable origin. Only
 -- explicit context-group requests are counted, by their declared payment date.
 'pending_payment_count',(select count(*) from public.payments where group_id=p_group_id and status='pending' and(p_from is null or payment_date>=p_from) and(p_to is null or payment_date<=p_to) and tuki_private.can_view_payment(id)),
 'people',coalesce((select jsonb_agg(row order by row.display_name,row.person_id) from(select l.person_id,
  case when tuki_private.can_view_person(l.person_id) then p.display_name else 'Participante histórico' end display_name,
  sum(advanced)::text advanced_minor,sum(consumed)::text consumed_minor,sum(paid)::text settled_paid_minor,sum(received)::text settled_received_minor,
  (sum(advanced)-sum(consumed)+sum(paid)-sum(received))::text balance_minor
  from ledger l join public.persons p on p.id=l.person_id group by l.person_id,p.display_name) row),'[]'::jsonb),
 'currencies',coalesce((select jsonb_agg(row order by row.currency) from(select currency,sum(original_minor)::text original_minor,sum(total_minor)::text total_minor from chosen group by currency) row),'[]'::jsonb),
 'categories',coalesce((select jsonb_agg(row order by row.category) from(select category,sum(total_minor)::text total_minor,count(*) count from chosen group by category) row),'[]'::jsonb),
 'timeline',coalesce((select jsonb_agg(row order by row.date) from(select date_trunc('month',expense_date)::date date,sum(total_minor)::text total_minor,count(*) count from chosen group by 1) row),'[]'::jsonb)) into result;
 return result;
end; $$;

create function public.tuki_expenses_page(p_group_id uuid default null,p_filters jsonb default '{}',p_page integer default 1,p_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f date;t date;payer uuid;participant uuid;lower_amount numeric;upper_amount numeric;sorting text;result jsonb;
begin
 if p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'invalid_report_filters' using errcode='22023';end if;
 f:=nullif(p_filters->>'from','')::date;t:=nullif(p_filters->>'to','')::date;
 perform tuki_private.report_guard(p_group_id,f,t);
 if p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not between 1 and 100 then raise exception 'invalid_report_page' using errcode='22023';end if;
 if char_length(coalesce(p_filters->>'q',''))>120 then raise exception 'invalid_report_filters' using errcode='22023';end if;
 payer:=nullif(p_filters->>'payer','')::uuid;participant:=nullif(p_filters->>'participant','')::uuid;
 if coalesce(p_filters->>'min_minor','')<>'' and (p_filters->>'min_minor')!~'^[0-9]{1,18}$' then raise exception 'invalid_report_filters';end if;
 if coalesce(p_filters->>'max_minor','')<>'' and (p_filters->>'max_minor')!~'^[0-9]{1,18}$' then raise exception 'invalid_report_filters';end if;
 lower_amount:=nullif(p_filters->>'min_minor','')::numeric;upper_amount:=nullif(p_filters->>'max_minor','')::numeric;
 if lower_amount>upper_amount then raise exception 'invalid_report_filters';end if;
 sorting:=coalesce(nullif(p_filters->>'sort',''),'date_desc');
 if sorting not in('date_desc','date_asc','amount_desc','amount_asc') or(coalesce(p_filters->>'status','')<>'' and p_filters->>'status' not in('active','void'))
 or(coalesce(p_filters->>'currency','')<>'' and p_filters->>'currency' not in('UYU','USD','ARS','BRL','EUR','GBP','CHF','CAD','AUD'))
 or(coalesce(p_filters->>'category','')<>'' and p_filters->>'category' not in('food','travel','home','sports','other')) then raise exception 'invalid_report_filters';end if;
 with filtered as materialized(select c.* from tuki_private.report_expenses c where tuki_private.is_member(c.group_id) and(p_group_id is null or c.group_id=p_group_id)
 and(f is null or c.expense_date>=f) and(t is null or c.expense_date<=t)
 and(nullif(p_filters->>'q','') is null or position(lower(p_filters->>'q') in lower(c.title))>0)
 and(payer is null or c.payer_id=payer) and(participant is null or exists(select 1 from public.expense_shares s where s.revision_id=c.revision_id and s.person_id=participant))
 and(nullif(p_filters->>'currency','') is null or c.currency=p_filters->>'currency') and(nullif(p_filters->>'category','') is null or c.category=p_filters->>'category')
 and(nullif(p_filters->>'status','') is null or c.status=p_filters->>'status') and(lower_amount is null or c.total_minor>=lower_amount) and(upper_amount is null or c.total_minor<=upper_amount)),
 page_rows as(select *,row_number() over(order by
 case when sorting='date_desc' then expense_date end desc,case when sorting='date_asc' then expense_date end asc,
 case when sorting='amount_desc' then total_minor end desc,case when sorting='amount_asc' then total_minor end asc,id) report_order from filtered order by
 case when sorting='date_desc' then expense_date end desc,case when sorting='date_asc' then expense_date end asc,
 case when sorting='amount_desc' then total_minor end desc,case when sorting='amount_asc' then total_minor end asc,id limit p_size offset (p_page-1)*p_size)
 select jsonb_build_object('total',(select count(*) from filtered),'page',p_page,'size',p_size,
 'items',coalesce((select jsonb_agg(to_jsonb(c)-'revision_id'-'original_minor'-'total_minor'-'rate'-'report_order'||jsonb_build_object('original_minor',c.original_minor::text,'total_minor',c.total_minor::text,'rate',c.rate::text,
 'payer_name',case when tuki_private.can_view_person(c.payer_id) then p.display_name else 'Participante histórico' end,
 'participants',coalesce((select jsonb_agg(jsonb_build_object('person_id',s.person_id,'display_name',case when tuki_private.can_view_person(s.person_id) then n.display_name else 'Participante histórico' end,'amount_minor',s.amount_minor::text) order by s.person_id) from public.expense_shares s join public.persons n on n.id=s.person_id where s.revision_id=c.revision_id),'[]'::jsonb)) order by c.report_order) from page_rows c join public.persons p on p.id=c.payer_id),'[]'::jsonb),
 'options',jsonb_build_object('people',coalesce((select jsonb_agg(row order by row.name,row.id) from(select distinct p.id,p.display_name name from public.group_members m join public.persons p on p.id=m.person_id where tuki_private.is_member(m.group_id) and(p_group_id is null or m.group_id=p_group_id) and tuki_private.can_view_person(p.id) order by p.display_name,p.id limit 500) row),'[]'::jsonb))) into result;
 return result;
end; $$;

create function public.tuki_history_page(p_group_id uuid default null,p_from date default null,p_to date default null,p_page integer default 1,p_size integer default 25) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 perform tuki_private.report_guard(p_group_id,p_from,p_to);
 if p_page is null or p_page not between 1 and 100000 or p_size is null or p_size not between 1 and 100 then raise exception 'invalid_report_page' using errcode='22023';end if;
 with events as materialized(
 select 'expense:'||v.id id,'expense' entity,v.expense_id entity_id,v.kind,v.created_at,r.expense_date operation_date,
 case when tuki_private.can_view_person(v.actor_id) then actor.display_name else 'Participante histórico' end actor_name,
 r.total_minor::text amount_minor,'UYU' currency,case when v.kind='voided' then 'void' else 'active' end status,v.group_id,g.name group_name,r.title,v.version
 from public.expense_events v join public.expense_revisions r on r.expense_id=v.expense_id and r.version=v.version
 join public.groups g on g.id=v.group_id join public.persons actor on actor.id=v.actor_id
 where tuki_private.is_member(v.group_id) and(p_group_id is null or v.group_id=p_group_id)
 union all
 select 'payment:'||v.id,'payment',p.id,v.action,v.created_at,p.payment_date,
 case when tuki_private.can_view_person(v.actor_id) then actor.display_name else 'Participante histórico' end,
 p.amount_minor::text,'UYU',v.to_status,p.group_id,
 case when tuki_private.is_member(p.group_id) then g.name else null end,'Pago registrado',null::integer
 from public.payment_events v join public.payments p on p.id=v.payment_id join public.persons actor on actor.id=v.actor_id left join public.groups g on g.id=p.group_id
 where tuki_private.can_view_payment(p.id) and(p_group_id is null or(p.group_id=p_group_id and tuki_private.is_member(p_group_id)))),
 filtered as materialized(select * from events where(p_from is null or created_at>=(p_from::timestamp at time zone 'America/Montevideo')) and(p_to is null or created_at<((p_to+1)::timestamp at time zone 'America/Montevideo'))),
 page_rows as(select * from filtered order by created_at desc,id desc limit p_size offset(p_page-1)*p_size)
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(row) order by row.created_at desc,row.id desc) from page_rows row),'[]'::jsonb),'total',(select count(*) from filtered),'page',p_page,'size',p_size) into result;
 return result;
end; $$;

create function public.tuki_group_export(p_group_id uuid,p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;part jsonb;items jsonb:='[]';n integer;
begin
 perform tuki_private.report_guard(p_group_id,p_from,p_to);
 if p_group_id is null then raise exception 'group_forbidden' using errcode='42501';end if;
 part:=public.tuki_expenses_page(p_group_id,jsonb_build_object('from',p_from,'to',p_to,'status','active'),1,100);
 if (part->>'total')::integer>1000 then raise exception 'report_export_limit' using errcode='54000';end if;
 items:=part->'items';
 for n in 2..ceil((part->>'total')::numeric/100)::integer loop
  part:=public.tuki_expenses_page(p_group_id,jsonb_build_object('from',p_from,'to',p_to,'status','active'),n,100);items:=items||(part->'items');
 end loop;
 result:=jsonb_build_object('statistics',public.tuki_group_statistics(p_group_id,p_from,p_to),'expenses',items);
 return result;
end; $$;

create function public.tuki_personal_statistics(p_from date default null,p_to date default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid;result jsonb;
begin
 perform tuki_private.report_guard(null,p_from,p_to);actor:=tuki_private.current_person();
 with chosen as materialized(select * from tuki_private.report_expenses c where status='active' and tuki_private.is_member(c.group_id) and(p_from is null or expense_date>=p_from) and(p_to is null or expense_date<=p_to)),
 mine as materialized(select c.* from chosen c where c.payer_id=actor or exists(select 1 from public.expense_shares s where s.revision_id=c.revision_id and s.person_id=actor)),
 pairs as materialized(select case when o.debtor_id=actor then o.creditor_id else o.debtor_id end counterparty,
 sum(case when o.debtor_id=actor then o.remaining_minor else -o.remaining_minor end) net
 from tuki_private.open_obligations o where o.active and actor in(o.debtor_id,o.creditor_id) group by 1),
 confirmed as materialized(select * from public.payments where status='confirmed' and actor in(payer_id,receiver_id) and(p_from is null or payment_date>=p_from) and(p_to is null or payment_date<=p_to))
 select jsonb_build_object('person_id',actor,'from',p_from,'to',p_to,'currency','UYU','expense_count',(select count(*) from mine),
 'advanced_minor',coalesce((select sum(total_minor) from mine where payer_id=actor),0)::text,
 'consumed_minor',coalesce((select sum(s.amount_minor) from mine c join public.expense_shares s on s.revision_id=c.revision_id where s.person_id=actor),0)::text,
 'owe_minor',coalesce((select sum(net) from pairs where net>0),0)::text,
 'owed_minor',coalesce((select sum(-net) from pairs where net<0),0)::text,
 'confirmed_paid_minor',coalesce((select sum(amount_minor) from confirmed where payer_id=actor),0)::text,
 'confirmed_received_minor',coalesce((select sum(amount_minor) from confirmed where receiver_id=actor),0)::text,
 'pending_payment_count',(select count(*) from public.payments p where status='pending' and actor in(payer_id,receiver_id) and(p_from is null or payment_date>=p_from) and(p_to is null or payment_date<=p_to)),
 'recent_groups',coalesce((select jsonb_agg(row order by row.last_activity_at desc,row.id) from(select c.group_id id,c.group_name name,max(c.created_at) last_activity_at from mine c group by c.group_id,c.group_name order by max(c.created_at) desc,c.group_id limit 5) row),'[]'::jsonb)) into result;
 return result;
end; $$;

revoke all on function public.tuki_group_statistics(uuid,date,date),public.tuki_expenses_page(uuid,jsonb,integer,integer),public.tuki_history_page(uuid,date,date,integer,integer),public.tuki_group_export(uuid,date,date),public.tuki_personal_statistics(date,date) from public,anon,authenticated;
grant execute on function public.tuki_group_statistics(uuid,date,date),public.tuki_expenses_page(uuid,jsonb,integer,integer),public.tuki_history_page(uuid,date,date,integer,integer),public.tuki_group_export(uuid,date,date),public.tuki_personal_statistics(date,date) to authenticated;
create index expense_revisions_report_period on public.expense_revisions(group_id,expense_date,expense_id,version);
create index obligations_report_origin on public.obligations(group_id,revision_id) where active;
create index expense_events_report_time on public.expense_events(group_id,created_at desc,id desc);
notify pgrst,'reload schema';
commit;
