-- Phase 4. Apply after 001, audited 002, and 003. Never run remotely automatically.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='group_members' and column_name='replaced_by_person_id')
 or pg_catalog.to_regprocedure('public.tuki_replace_guest(uuid,uuid,uuid,boolean)') is null then
 raise exception 'phase3_correction_required: apply migrations 001, audited 002 and 003 first'; end if;
end $$;
alter table public.groups add column had_financial_activity boolean not null default false;
alter table public.group_events drop constraint group_events_event_type_check;
alter table public.group_events add constraint group_events_event_type_check check (event_type in (
 'created','edited','archived','restored','guest_added','person_added','guest_renamed','member_changed',
 'invitation_created','invitation_revoked','invitation_accepted','guest_replaced','expense_created','expense_edited','expense_voided','member_removed'
));
create table public.expenses (
 id uuid primary key, group_id uuid not null references public.groups(id),
 created_by uuid not null references public.persons(id), created_at timestamptz not null default now(),
 status text not null default 'active' check(status in ('active','void')), version integer not null check(version>0),
 request_hash text not null, voided_at timestamptz
);
create index expenses_group on public.expenses(group_id,created_at desc);
create table public.expense_revisions (
 id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.expenses(id), group_id uuid not null references public.groups(id),
 version integer not null, title text not null check(char_length(btrim(title)) between 1 and 120), notes text not null check(char_length(notes)<=2000),
 category text not null check(category in ('food','travel','home','sports','other')), expense_date date not null,
 payer_id uuid not null, original_currency text not null check(original_currency in ('UYU','USD','ARS','BRL','EUR','GBP','CHF','CAD','AUD')),
 original_minor numeric(16,0) not null check(original_minor>0), exchange_rate numeric(18,6) not null check(exchange_rate>0),
 total_minor numeric(16,0) not null check(total_minor>0), split_method text not null check(split_method in ('equal','percent','custom','units')),
 actor_id uuid not null references public.persons(id), created_at timestamptz not null default clock_timestamp(),
 receipt_data bytea, receipt_mime text, receipt_name text,
 unique(expense_id,version), foreign key(group_id,payer_id) references public.group_members(group_id,person_id),
 check(receipt_data is null or octet_length(receipt_data)<=524288)
);
create table public.expense_shares (
 revision_id uuid not null references public.expense_revisions(id), person_id uuid not null references public.persons(id),
 amount_minor numeric(16,0) not null check(amount_minor>=0), input_value numeric(30,0) not null check(input_value>=0), primary key(revision_id,person_id)
);
create table public.expense_people_history (
 expense_id uuid not null references public.expenses(id), group_id uuid not null, person_id uuid not null,
 primary key(expense_id,person_id), foreign key(group_id,person_id) references public.group_members(group_id,person_id)
);
create table public.obligations (
 id uuid primary key default gen_random_uuid(), expense_id uuid not null references public.expenses(id), revision_id uuid not null references public.expense_revisions(id),
 group_id uuid not null references public.groups(id), debtor_id uuid not null references public.persons(id), creditor_id uuid not null references public.persons(id),
 amount_minor numeric(16,0) not null check(amount_minor>0), active boolean not null default true,
 unique(revision_id,debtor_id), check(debtor_id<>creditor_id)
);
create index obligations_pair on public.obligations(debtor_id,creditor_id) where active;
create table public.expense_events (
 id bigint generated always as identity primary key, expense_id uuid not null references public.expenses(id),
 group_id uuid not null references public.groups(id), actor_id uuid not null references public.persons(id),
 kind text not null check(kind in ('created','edited','voided')), version integer not null, created_at timestamptz not null default clock_timestamp()
);
create table public.lifecycle_audit (
 id bigint generated always as identity primary key, actor_id uuid not null references public.persons(id),
 entity_type text not null, entity_id uuid not null, result text not null, created_at timestamptz not null default clock_timestamp()
);
alter table public.expenses enable row level security;
alter table public.expense_revisions enable row level security;
alter table public.expense_shares enable row level security;
alter table public.expense_people_history enable row level security;
alter table public.obligations enable row level security;
alter table public.expense_events enable row level security;
alter table public.lifecycle_audit enable row level security;
revoke all on public.expenses,public.expense_revisions,public.expense_shares,public.expense_people_history,public.obligations,public.expense_events,public.lifecycle_audit from public,anon,authenticated;
revoke all on sequence public.expense_events_id_seq,public.lifecycle_audit_id_seq from public,anon,authenticated;
grant select on public.expenses,public.expense_revisions,public.expense_shares,public.expense_people_history,public.obligations,public.expense_events,public.lifecycle_audit to authenticated;
create policy expenses_origin on public.expenses for select to authenticated using(tuki_private.is_member(group_id));
create policy revisions_origin on public.expense_revisions for select to authenticated using(tuki_private.is_member(group_id));
create policy shares_origin on public.expense_shares for select to authenticated using(exists(select 1 from public.expense_revisions r where r.id=revision_id));
create policy finance_history_origin on public.expense_people_history for select to authenticated using(tuki_private.is_member(group_id));
create policy obligations_origin on public.obligations for select to authenticated using(tuki_private.is_member(group_id));
create policy expense_events_origin on public.expense_events for select to authenticated using(tuki_private.is_member(group_id));
create policy lifecycle_own on public.lifecycle_audit for select to authenticated using(actor_id=tuki_private.current_person());

create function tuki_private.decimal_units(value text, scale integer) returns numeric language plpgsql immutable set search_path='' as $$
begin
 if scale<0 or scale>6 or value is null or char_length(value)>24 or value !~ ('^[0-9]+(\.[0-9]{1,'||scale||'})?$') then raise exception 'invalid_decimal'; end if;
 return value::numeric * power(10::numeric,scale);
end; $$;
revoke all on function tuki_private.decimal_units(text,integer) from public,anon,authenticated;

create function public.tuki_save_expense(p_id uuid,p_group_id uuid,p_expected_version integer,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid; old public.expenses; prior public.expense_revisions; rev uuid; next_version integer; archived timestamptz;
 original numeric; rate numeric; total numeric; method text; payer uuid; ids uuid[]; entry jsonb; participant_id uuid; weight numeric; weights_sum numeric:=0;
 receipt bytea; mime text; filename text; digest text; record_shares record;
begin
 actor:=public.tuki_ensure_person();
 select archived_at into archived from public.groups where id=p_group_id for update;
 if not found or not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501'; end if;
 if archived is not null then raise exception 'group_archived'; end if;
 digest:=encode(sha256(convert_to(p_data::text,'UTF8')),'hex');
 select * into old from public.expenses where id=p_id for update;
 if found then
   if old.group_id<>p_group_id then raise exception 'expense_forbidden' using errcode='42501'; end if;
   if p_expected_version=0 then
     if old.created_by=actor and old.request_hash=digest then return p_id; end if;
     raise exception 'expense_conflict';
   end if;
   if old.created_by<>actor and not tuki_private.is_admin(p_group_id) then raise exception 'expense_forbidden' using errcode='42501'; end if;
   if old.version is distinct from p_expected_version or old.status<>'active' then raise exception 'expense_conflict'; end if;
   select * into prior from public.expense_revisions where expense_id=p_id and version=old.version;
   next_version:=old.version+1;
 else
   if p_expected_version is distinct from 0 then raise exception 'expense_conflict'; end if;
   next_version:=1;
 end if;
 if p_id is null or p_data->>'currency' not in ('UYU','USD','ARS','BRL','EUR','GBP','CHF','CAD','AUD') then raise exception 'invalid_expense'; end if;
 original:=tuki_private.decimal_units(p_data->>'amount',2);
 rate:=case when p_data->>'currency'='UYU' then 1000000 else tuki_private.decimal_units(p_data->>'rate',6) end;
 total:=floor((original*rate+500000)/1000000);
 if original<=0 or original>1000000000000 or rate<=0 or rate>1000000000000 or total<=0 or total>100000000000000 then raise exception 'invalid_expense'; end if;
 method:=p_data->>'method'; payer:=(p_data->>'payerId')::uuid;
 if method is null or method not in ('equal','percent','custom','units') or jsonb_typeof(p_data->'shares') is distinct from 'array' or jsonb_array_length(p_data->'shares') not between 1 and 100 then raise exception 'invalid_split'; end if;
 select array_agg((x->>'personId')::uuid) into ids from jsonb_array_elements(p_data->'shares') x;
 if (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'invalid_split'; end if;
 for participant_id in select distinct x from unnest(ids||array[payer]) x loop
   if not exists(select 1 from public.group_members m join public.persons p on p.id=m.person_id where m.group_id=p_group_id and m.person_id=participant_id and m.replaced_by_person_id is null and p.merged_into is null
     and (m.status='active' or (m.status='retired' and prior.id is not null and (prior.payer_id=participant_id or exists(select 1 from public.expense_shares s where s.revision_id=prior.id and s.person_id=participant_id))))) then raise exception 'invalid_participant'; end if;
 end loop;
 for entry in select * from jsonb_array_elements(p_data->'shares') loop
   weight:=case when method='equal' then 1 else tuki_private.decimal_units(entry->>'input',case when method='custom' then 2 else 4 end) end;
   if weight<0 or (method='units' and weight<=0) then raise exception 'invalid_split'; end if;
   weights_sum:=weights_sum+weight;
 end loop;
 if weights_sum<=0 or (method='percent' and weights_sum<>1000000) or (method='custom' and weights_sum<>total) then raise exception 'invalid_split'; end if;
 if p_data ? 'receipt' and p_data->'receipt'<>'null'::jsonb then
   receipt:=decode(p_data->'receipt'->>'data','base64'); mime:=p_data->'receipt'->>'mime'; filename:=left(p_data->'receipt'->>'name',120);
   if receipt is null or octet_length(receipt)=0 or octet_length(receipt)>524288 or mime is null or mime not in ('image/png','image/jpeg','application/pdf')
      or not ((mime='image/png' and encode(substring(receipt from 1 for 8),'hex')='89504e470d0a1a0a') or (mime='image/jpeg' and encode(substring(receipt from 1 for 3),'hex')='ffd8ff') or (mime='application/pdf' and encode(substring(receipt from 1 for 5),'hex')='255044462d')) then raise exception 'invalid_receipt'; end if;
 elsif p_data->>'removeReceipt' is distinct from 'true' then receipt:=prior.receipt_data; mime:=prior.receipt_mime; filename:=prior.receipt_name;
 end if;
 if prior.id is null then
   insert into public.expenses(id,group_id,created_by,version,request_hash) values(p_id,p_group_id,actor,1,digest);
 else update public.expenses set version=next_version where id=p_id; update public.obligations set active=false where expense_id=p_id and active; end if;
 insert into public.expense_revisions(expense_id,group_id,version,title,notes,category,expense_date,payer_id,original_currency,original_minor,exchange_rate,total_minor,split_method,actor_id,receipt_data,receipt_mime,receipt_name)
 values(p_id,p_group_id,next_version,btrim(p_data->>'title'),coalesce(p_data->>'notes',''),p_data->>'category',(p_data->>'date')::date,payer,p_data->>'currency',original,rate/1000000,total,method,actor,receipt,mime,filename) returning id into rev;
 for record_shares in
   with items as (select (x->>'personId')::uuid as pid,case when method='equal' then 1 else tuki_private.decimal_units(x->>'input',case when method='custom' then 2 else 4 end) end as w from jsonb_array_elements(p_data->'shares') x),
   bases as (select *,case when method='custom' then w else floor(total*w/weights_sum) end as base,mod(total*w,weights_sum) as remainder from items),
   ranked as (select *,row_number() over(order by remainder desc,pid::text) as rank,total-sum(base) over() as leftover from bases)
   select pid,w,base+case when rank<=leftover then 1 else 0 end as amount from ranked
 loop
   insert into public.expense_shares values(rev,record_shares.pid,record_shares.amount,record_shares.w);
   if record_shares.pid<>payer and record_shares.amount>0 then insert into public.obligations(expense_id,revision_id,group_id,debtor_id,creditor_id,amount_minor) values(p_id,rev,p_group_id,record_shares.pid,payer,record_shares.amount); end if;
 end loop;
 insert into public.expense_people_history select p_id,p_group_id,x from (select distinct x from unnest(ids||array[payer]) x) participants on conflict do nothing;
 insert into public.expense_events(expense_id,group_id,actor_id,kind,version) values(p_id,p_group_id,actor,case when prior.id is null then 'created' else 'edited' end,next_version);
 update public.groups set had_financial_activity=true where id=p_group_id;
 perform tuki_private.event(p_group_id,case when prior.id is null then 'expense_created' else 'expense_edited' end);
 return p_id;
end; $$;

create function public.tuki_void_expense(p_id uuid,p_expected_version integer,p_confirm boolean) returns void
language plpgsql security definer set search_path='' as $$
declare e public.expenses; actor uuid; g uuid;
begin
 if p_confirm is distinct from true then raise exception 'confirmation_required'; end if;
 actor:=public.tuki_ensure_person(); select group_id into g from public.expenses where id=p_id;
 perform id from public.groups where id=g for update;
 if not found or not tuki_private.is_member(g) then raise exception 'expense_forbidden' using errcode='42501'; end if;
 select * into e from public.expenses where id=p_id for update;
 if e.created_by<>actor and not tuki_private.is_admin(g) then raise exception 'expense_forbidden' using errcode='42501'; end if;
 if e.version is distinct from p_expected_version or e.status<>'active' then raise exception 'expense_conflict'; end if;
 update public.expenses set status='void',voided_at=clock_timestamp() where id=p_id;
 update public.obligations set active=false where expense_id=p_id;
 insert into public.expense_events(expense_id,group_id,actor_id,kind,version) values(p_id,g,actor,'voided',e.version);
 perform tuki_private.event(g,'expense_voided');
end; $$;

-- Returns only the explicitly allowed projection; never expense IDs, notes,
-- original currencies, receipts or other private details from another group.
create function public.tuki_group_finances(p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501'; end if;
 return jsonb_build_object('obligations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'debtor_id',o.debtor_id,'creditor_id',o.creditor_id,'debtor_name',d.display_name,'creditor_name',c.display_name,'amount_minor',o.amount_minor::text,'origin_group_id',o.group_id,'origin_group_name',g.name))
   from public.obligations o join public.groups g on g.id=o.group_id join public.persons d on d.id=o.debtor_id join public.persons c on c.id=o.creditor_id
   where o.active and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=o.debtor_id and m.status='active')
   and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.person_id=o.creditor_id and m.status='active')),'[]'::jsonb),
 'ledger',coalesce((with current as (select r.* from public.expenses e join public.expense_revisions r on r.expense_id=e.id and r.version=e.version where e.group_id=p_group_id and e.status='active'),
   totals as (select payer_id as person_id,total_minor as paid,0::numeric as consumed from current union all select s.person_id,0,s.amount_minor from current r join public.expense_shares s on s.revision_id=r.id)
   select jsonb_agg(row) from (select t.person_id,p.display_name,sum(t.paid)::text as paid_minor,sum(t.consumed)::text as consumed_minor,(sum(t.paid)-sum(t.consumed))::text as balance_minor from totals t join public.persons p on p.id=t.person_id group by t.person_id,p.display_name) row),'[]'::jsonb));
end; $$;
create function public.tuki_my_obligations() returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
 actor:=public.tuki_ensure_person();
 return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'debtor_id',o.debtor_id,'creditor_id',o.creditor_id,'debtor_name',d.display_name,'creditor_name',c.display_name,'amount_minor',o.amount_minor::text,'origin_group_id',o.group_id,'origin_group_name',g.name))
 from public.obligations o join public.groups g on g.id=o.group_id join public.persons d on d.id=o.debtor_id join public.persons c on c.id=o.creditor_id where o.active and actor in (o.debtor_id,o.creditor_id)),'[]'::jsonb);
end; $$;
revoke all on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_void_expense(uuid,integer,boolean),public.tuki_group_finances(uuid),public.tuki_my_obligations() from public,anon,authenticated;
grant execute on function public.tuki_save_expense(uuid,uuid,integer,jsonb),public.tuki_void_expense(uuid,integer,boolean),public.tuki_group_finances(uuid),public.tuki_my_obligations() to authenticated;
-- Monetary values cross the JSON boundary as decimal strings, never floats.
create function public.tuki_list_expenses(p_group_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or (p_group_id is not null and not tuki_private.is_member(p_group_id)) then raise exception 'group_forbidden' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(row order by row.expense_date desc,row.id) from (
 select e.id,e.group_id,g.name as group_name,e.status,e.version,r.title,r.category,r.expense_date,r.total_minor::text as total_minor
 from public.expenses e join public.expense_revisions r on r.expense_id=e.id and r.version=e.version join public.groups g on g.id=e.group_id
 where tuki_private.is_member(e.group_id) and (p_group_id is null or e.group_id=p_group_id)) row),'[]'::jsonb);
end; $$;
create function public.tuki_expense_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.expenses; result jsonb;
begin
 select * into e from public.expenses where id=p_id;
 if not found or not tuki_private.is_member(e.group_id) then raise exception 'expense_forbidden' using errcode='42501'; end if;
 select jsonb_build_object('id',e.id,'group_id',e.group_id,'group_name',g.name,'archived',g.archived_at is not null,'status',e.status,'version',e.version,
 'can_edit',e.created_by=tuki_private.current_person() or tuki_private.is_admin(e.group_id),
 'title',r.title,'notes',r.notes,'category',r.category,'date',r.expense_date,'payer_id',r.payer_id,'currency',r.original_currency,
 'original_minor',r.original_minor::text,'rate',r.exchange_rate::text,'total_minor',r.total_minor::text,'method',r.split_method,
 'receipt',case when r.receipt_data is not null then jsonb_build_object('id',r.id,'name',r.receipt_name) else null end,
 'shares',(select jsonb_agg(jsonb_build_object('personId',s.person_id,'amount_minor',s.amount_minor::text,'input_value',s.input_value::text)) from public.expense_shares s where s.revision_id=r.id),
 'people',(select jsonb_agg(jsonb_build_object('id',m.person_id,'name',p.display_name,'status',m.status,'replaced',m.replaced_by_person_id is not null)) from public.group_members m join public.persons p on p.id=m.person_id where m.group_id=e.group_id),
 'history',(select jsonb_agg(jsonb_build_object('id',h.id,'version',h.version,'title',h.title,'total_minor',h.total_minor::text,'created_at',h.created_at,'receipt',h.receipt_data is not null) order by h.version desc) from public.expense_revisions h where h.expense_id=e.id),
 'events',(select jsonb_agg(jsonb_build_object('kind',v.kind,'version',v.version,'created_at',v.created_at) order by v.id) from public.expense_events v where v.expense_id=e.id)) into result
 from public.expense_revisions r join public.groups g on g.id=e.group_id where r.expense_id=e.id and r.version=e.version;
 return result;
end; $$;
create function public.tuki_finance_activity() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(row order by row.id desc),'[]'::jsonb) from (
 select v.id,v.expense_id,v.kind,v.version,v.created_at,g.name as group_name,r.title
 from public.expense_events v join public.groups g on g.id=v.group_id join public.expense_revisions r on r.expense_id=v.expense_id and r.version=v.version
 where tuki_private.is_member(v.group_id) order by v.id desc limit 100) row
$$;
revoke all on function public.tuki_list_expenses(uuid),public.tuki_expense_detail(uuid),public.tuki_finance_activity() from public,anon,authenticated;
grant execute on function public.tuki_list_expenses(uuid),public.tuki_expense_detail(uuid),public.tuki_finance_activity() to authenticated;
notify pgrst,'reload schema';
commit;
