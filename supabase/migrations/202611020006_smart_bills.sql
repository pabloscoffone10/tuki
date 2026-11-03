-- Phase 4.5. Apply once after 001-005 as project owner. No remote execution.
begin;
do $$ begin
 if pg_catalog.to_regprocedure('public.tuki_save_expense(uuid,uuid,integer,jsonb)') is null
 or pg_catalog.to_regprocedure('public.tuki_delete_group(uuid,boolean)') is null
 or pg_catalog.to_regclass('storage.objects') is null then
  raise exception 'phase4_and_storage_required: apply migrations 001-005 and enable Supabase Storage first';
 end if;
end $$;
create table public.ticket_uploads (
 id uuid primary key, group_id uuid references public.groups(id) on delete set null,
 created_by uuid not null references public.persons(id), path text not null unique,
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','application/pdf')),
 size_bytes integer not null check(size_bytes between 1 and 2097152), created_at timestamptz not null default clock_timestamp(),
 object_id uuid references storage.objects(id)
);
create table public.smart_bill_revisions (
 revision_id uuid primary key references public.expense_revisions(id), group_id uuid not null references public.groups(id),
 document jsonb not null, upload_id uuid references public.ticket_uploads(id)
);
create table public.receipt_scan_requests (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 hash text not null check(hash~'^[a-f0-9]{64}$'), created_at timestamptz not null default clock_timestamp()
);
create index receipt_scan_user_date on public.receipt_scan_requests(user_id,created_at);
alter table public.ticket_uploads enable row level security;
alter table public.smart_bill_revisions enable row level security;
alter table public.receipt_scan_requests enable row level security;
revoke all on public.ticket_uploads,public.smart_bill_revisions,public.receipt_scan_requests from public,anon,authenticated;
grant select on public.smart_bill_revisions to authenticated;
create policy smart_bill_origin on public.smart_bill_revisions for select to authenticated using(tuki_private.is_member(group_id));

-- Exact largest-remainder allocator, same ordering and rules as Phase 4.
create function tuki_private.bill_decimal(value jsonb,scale integer) returns numeric
language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(value) is distinct from 'string' or (value#>>'{}') !~ ('^[0-9]{1,14}(\.[0-9]{1,'||scale||'})?$') then raise exception 'invalid_decimal'; end if;
 return tuki_private.decimal_units(value#>>'{}',scale);
end; $$;
revoke all on function tuki_private.bill_decimal(jsonb,integer) from public,anon,authenticated;
create function tuki_private.bill_allocate(p_total numeric,p_people jsonb,p_method text) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb; total_weight numeric;
begin
 if jsonb_typeof(p_people) is distinct from 'array' or jsonb_array_length(p_people) not between 1 and 100
 or (select count(distinct (x->>'personId')::uuid) from jsonb_array_elements(p_people) x)<>jsonb_array_length(p_people) then raise exception 'bill_unassigned'; end if;
 if exists(select 1 from jsonb_array_elements(p_people) x where jsonb_typeof(x->'personId') is distinct from 'string' or jsonb_typeof(x->'input') is distinct from 'string') then raise exception 'invalid_bill'; end if;
 perform tuki_private.bill_decimal(x->'input',case when p_method='custom' then 2 else 4 end) from jsonb_array_elements(p_people) x;
 select sum(case when p_method='equal' then 1 else tuki_private.bill_decimal(x->'input',case when p_method='custom' then 2 else 4 end) end) into total_weight from jsonb_array_elements(p_people) x;
 if total_weight is null or (total_weight<=0 and not(p_method='custom' and p_total=0 and total_weight=0)) or (p_method='custom' and total_weight<>p_total)
 or (p_method='units' and exists(select 1 from jsonb_array_elements(p_people) x where tuki_private.bill_decimal(x->'input',4)<=0)) then raise exception 'invalid_split'; end if;
 if p_total=0 then return (select jsonb_agg(jsonb_build_object('personId',(x->>'personId')::uuid,'amount','0')) from jsonb_array_elements(p_people) x); end if;
 with weights as (select (x->>'personId')::uuid pid,case when p_method='equal' then 1 else tuki_private.bill_decimal(x->'input',case when p_method='custom' then 2 else 4 end) end w from jsonb_array_elements(p_people) x),
 bases as (select *,case when p_method='custom' then w else floor(p_total*w/total_weight) end base,mod(p_total*w,total_weight) remainder from weights),
 ranked as (select *,row_number() over(order by remainder desc,pid::text) rank,p_total-sum(base) over() leftover from bases)
 select jsonb_agg(jsonb_build_object('personId',pid,'amount',(base+case when rank<=leftover then 1 else 0 end)::text)) into result from ranked;
 return result;
end; $$;
revoke all on function tuki_private.bill_allocate(numeric,jsonb,text) from public,anon,authenticated;

create function tuki_private.calculate_bill(b jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare item jsonb; adjustment jsonb; part jsonb; people jsonb; balances jsonb:='{}';
 qty numeric; price numeric; cost numeric; discount numeric; amount numeric; current_total numeric; original_total numeric; added_tip numeric:=0;
 negative boolean; method text; key text; next_amount numeric; currency text; rate numeric; uyu numeric; shares jsonb;
begin
 if jsonb_typeof(b->'items') is distinct from 'array' or jsonb_array_length(b->'items') not between 1 and 80
 or jsonb_typeof(b->'adjustments') is distinct from 'array' or jsonb_array_length(b->'adjustments')>12
 or b->>'confirmed' is distinct from 'true' then raise exception 'bill_confirmation_required'; end if;
 if jsonb_typeof(b->'confirmed') is distinct from 'boolean'
 or exists(select 1 from unnest(array['currency','rate','noTotalReason']) k where jsonb_typeof(b->k) is distinct from 'string')
 or coalesce(jsonb_typeof(b->'ticketTotal'),'missing') not in ('string','null')
 or coalesce(jsonb_typeof(b->'uploadId'),'missing') not in ('string','null') or char_length(b->>'noTotalReason')>300 then raise exception 'invalid_bill'; end if;
 if (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(b->'items') x)<>jsonb_array_length(b->'items')
 or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(b->'adjustments') x)<>jsonb_array_length(b->'adjustments') then raise exception 'invalid_bill'; end if;
 for item in select * from jsonb_array_elements(b->'items') loop
  if jsonb_typeof(item->'reviewed') is distinct from 'boolean'
  or exists(select 1 from unnest(array['id','name','quantity','priceMode','price','discount','split']) k where jsonb_typeof(item->k) is distinct from 'string') then raise exception 'invalid_bill'; end if;
  if char_length(btrim(coalesce(item->>'name',''))) not between 1 and 120 or item->>'reviewed' is distinct from 'true'
   or coalesce(item->>'priceMode','') not in ('unit','subtotal') or coalesce(item->>'split','') not in ('equal','units') then raise exception 'bill_review_required'; end if;
  qty:=tuki_private.bill_decimal(item->'quantity',4); price:=tuki_private.bill_decimal(item->'price',2); discount:=tuki_private.bill_decimal(item->'discount',2);
  cost:=case when item->>'priceMode'='unit' then floor((qty*price+5000)/10000) else price end;
  if qty<=0 or discount>cost then raise exception 'invalid_bill'; end if;
  people:=item->'consumers'; method:=item->>'split';
  if method='units' and (select sum(tuki_private.bill_decimal(x->'input',4)) from jsonb_array_elements(people) x) is distinct from qty then raise exception 'bill_quantities'; end if;
  for part in select * from jsonb_array_elements(tuki_private.bill_allocate(cost-discount,people,method)) loop
   key:=part->>'personId'; balances:=jsonb_set(balances,array[key],to_jsonb(coalesce((balances->>key)::numeric,0)+(part->>'amount')::numeric));
  end loop;
 end loop;
 for adjustment in select * from jsonb_array_elements(b->'adjustments') loop
  if exists(select 1 from unnest(array['id','label','kind','mode','value','distribution']) k where jsonb_typeof(adjustment->k) is distinct from 'string')
  or exists(select 1 from unnest(array['subtract','included','reviewed']) k where jsonb_typeof(adjustment->k) is distinct from 'boolean') then raise exception 'invalid_bill'; end if;
  if adjustment->>'reviewed' is distinct from 'true' or char_length(btrim(coalesce(adjustment->>'label',''))) not between 1 and 80
   or coalesce(adjustment->>'kind','') not in ('discount','service','tip','rounding') or coalesce(adjustment->>'mode','') not in ('fixed','percent')
   or coalesce(adjustment->>'distribution','') not in ('equal','proportional','custom') then raise exception 'invalid_bill'; end if;
  select sum(value::numeric) into current_total from jsonb_each_text(balances);
  amount:=case when adjustment->>'mode'='percent' then floor((current_total*tuki_private.bill_decimal(adjustment->'value',4)+500000)/1000000) else tuki_private.bill_decimal(adjustment->'value',2) end;
  negative:=adjustment->>'kind'='discount' or (adjustment->>'kind'='rounding' and adjustment->>'subtract'='true');
  people:=adjustment->'consumers'; method:=case adjustment->>'distribution' when 'custom' then 'custom' when 'equal' then 'equal' else 'units' end;
  if adjustment->>'distribution'='proportional' then
   select coalesce(jsonb_agg(jsonb_build_object('personId',x->>'personId','input',round((balances->>(x->>'personId'))::numeric/10000,4)::text)),'[]') into people from jsonb_array_elements(people) x where coalesce((balances->>(x->>'personId'))::numeric,0)>0;
  end if;
  for part in select * from jsonb_array_elements(tuki_private.bill_allocate(amount,people,method)) loop
   key:=part->>'personId';next_amount:=coalesce((balances->>key)::numeric,0)+(part->>'amount')::numeric*case when negative then -1 else 1 end;
   if next_amount<0 then raise exception 'bill_negative'; end if;
   balances:=jsonb_set(balances,array[key],to_jsonb(next_amount));
  end loop;
  if adjustment->>'kind'='tip' and adjustment->>'included'='false' then added_tip:=added_tip+amount; end if;
 end loop;
 select sum(value::numeric) into original_total from jsonb_each_text(balances);
 if b->>'ticketTotal' is not null then
  if tuki_private.bill_decimal(b->'ticketTotal',2)<>original_total-added_tip then raise exception 'bill_total_mismatch'; end if;
 elsif char_length(btrim(coalesce(b->>'noTotalReason',''))) not between 8 and 300 then raise exception 'bill_total_required'; end if;
 currency:=b->>'currency';rate:=case when currency='UYU' then 1000000 else tuki_private.bill_decimal(b->'rate',6) end;
 uyu:=floor((original_total*rate+500000)/1000000);
 if original_total<=0 or original_total>1000000000000 or rate<=0 or rate>1000000000000 or uyu<=0 or uyu>100000000000000 then raise exception 'invalid_expense'; end if;
 select jsonb_agg(jsonb_build_object('personId',j.key,'input',round(j.value::numeric/10000,4)::text)) into people from jsonb_each_text(balances) j where j.value::numeric>0;
 select jsonb_agg(jsonb_build_object('personId',x->>'personId','input',round((x->>'amount')::numeric/100,2)::text)) into shares from jsonb_array_elements(tuki_private.bill_allocate(uyu,people,'units')) x;
 select shares||coalesce(jsonb_agg(jsonb_build_object('personId',j.key,'input','0.00')),'[]') into shares from jsonb_each_text(balances) j where j.value::numeric=0;
 return jsonb_build_object('amount',round(original_total/100,2)::text,'total_minor',uyu::text,'shares',shares);
end; $$;
revoke all on function tuki_private.calculate_bill(jsonb) from public,anon,authenticated;

-- Keep the audited financial engine; wrap it instead of duplicating obligations.
alter function public.tuki_save_expense(uuid,uuid,integer,jsonb) set schema tuki_private;
alter function tuki_private.tuki_save_expense(uuid,uuid,integer,jsonb) rename to save_expense_phase4;
revoke all on function tuki_private.save_expense_phase4(uuid,uuid,integer,jsonb) from public,anon,authenticated;
create function public.tuki_save_expense(p_id uuid,p_group_id uuid,p_expected_version integer,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare b jsonb; calculated jsonb; rev uuid; upload uuid; result uuid;
begin
 perform public.tuki_ensure_person();
 perform id from public.groups where id=p_group_id for update;
 if not found or not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501'; end if;
 b:=p_data->'smartBill';
 if b is null or b='null'::jsonb then
  if exists(select 1 from public.smart_bill_revisions s join public.expense_revisions r on r.id=s.revision_id where r.expense_id=p_id and s.group_id=p_group_id) then raise exception 'bill_document_required'; end if;
 else
  if octet_length(b::text)>120000 then raise exception 'invalid_bill'; end if;
  calculated:=tuki_private.calculate_bill(b);upload:=(b->>'uploadId')::uuid;
  if upload is not null and not exists(select 1 from public.ticket_uploads u join storage.objects o on o.bucket_id='tuki-tickets' and o.name=u.path where u.id=upload and u.group_id=p_group_id
   and (u.created_by=tuki_private.current_person() or exists(select 1 from public.smart_bill_revisions s join public.expense_revisions r on r.id=s.revision_id where s.upload_id=u.id and r.expense_id=p_id))) then raise exception 'bill_ticket_unavailable'; end if;
  -- FK protects the immutable receipt even if Storage DELETE started before
  -- this transaction committed and evaluated its policy against an old snapshot.
  if upload is not null then
   update public.ticket_uploads u set object_id=o.id from storage.objects o where u.id=upload and o.bucket_id='tuki-tickets' and o.name=u.path;
   if not found then raise exception 'bill_ticket_unavailable'; end if;
  end if;
  p_data:=p_data||jsonb_build_object('amount',calculated->>'amount','currency',b->>'currency','rate',b->>'rate','method','custom','shares',calculated->'shares');
 end if;
 result:=tuki_private.save_expense_phase4(p_id,p_group_id,p_expected_version,p_data);
 if b is not null and b<>'null'::jsonb then
  select r.id into rev from public.expense_revisions r join public.expenses e on e.id=r.expense_id and e.version=r.version where e.id=p_id;
  insert into public.smart_bill_revisions(revision_id,group_id,document,upload_id) values(rev,p_group_id,b,upload) on conflict(revision_id) do nothing;
 end if;
 return result;
end; $$;
revoke all on function public.tuki_save_expense(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.tuki_save_expense(uuid,uuid,integer,jsonb) to authenticated;

create function public.tuki_reserve_ticket(p_id uuid,p_group_id uuid,p_mime text,p_size integer) returns text
language plpgsql security definer set search_path='' as $$
declare actor uuid; result text;
begin
 actor:=public.tuki_ensure_person();perform id from public.groups where id=p_group_id for update;
 if not found or not tuki_private.is_member(p_group_id) or exists(select 1 from public.groups where id=p_group_id and archived_at is not null) then raise exception 'group_forbidden' using errcode='42501'; end if;
 if exists(select 1 from public.ticket_uploads where id=p_id) then
  select path into result from public.ticket_uploads where id=p_id and group_id=p_group_id and created_by=actor and mime=p_mime and size_bytes=p_size;
  if result is null then raise exception 'bill_ticket_unavailable'; end if;
  return result;
 end if;
 -- Serialize the actor across groups too, so quotas cannot be raced.
 perform user_id from public.profiles where user_id=auth.uid() for update;
 if (select count(*) from public.ticket_uploads where created_by=actor and created_at>clock_timestamp()-interval '1 day')>=10 then raise exception 'ticket_limit'; end if;
 result:=p_group_id::text||'/'||p_id::text;
 insert into public.ticket_uploads(id,group_id,created_by,path,mime,size_bytes) values(p_id,p_group_id,actor,result,p_mime,p_size);
 return result;
end; $$;
create function tuki_private.ticket_access(p_path text,p_write boolean) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.ticket_uploads u where u.path=p_path and tuki_private.is_member(u.group_id) and
 case when p_write then u.created_by=tuki_private.current_person() and u.created_at>now()-interval '1 day' and not exists(select 1 from public.smart_bill_revisions s where s.upload_id=u.id)
 else u.created_by=tuki_private.current_person() or exists(select 1 from public.smart_bill_revisions s where s.upload_id=u.id) end)
$$;
revoke all on function tuki_private.ticket_access(text,boolean) from public,anon,authenticated;
grant execute on function tuki_private.ticket_access(text,boolean) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('tuki-tickets','tuki-tickets',false,2097152,array['image/jpeg','image/png','image/webp','application/pdf']);
create policy tuki_ticket_read on storage.objects for select to authenticated using(bucket_id='tuki-tickets' and tuki_private.ticket_access(name,false));
create policy tuki_ticket_insert on storage.objects for insert to authenticated with check(bucket_id='tuki-tickets' and tuki_private.ticket_access(name,true));
create policy tuki_ticket_delete_pending on storage.objects for delete to authenticated using(bucket_id='tuki-tickets' and tuki_private.ticket_access(name,true));

create function public.tuki_reserve_scan(p_group_id uuid,p_hash text) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform public.tuki_ensure_person();
 if not tuki_private.is_member(p_group_id) then raise exception 'group_forbidden' using errcode='42501'; end if;
 -- A short DB-only critical section; no lock is held during the external API call.
 lock table public.receipt_scan_requests in share row exclusive mode;
 if exists(select 1 from public.receipt_scan_requests where user_id=auth.uid() and hash=p_hash and created_at>clock_timestamp()-interval '1 day') then raise exception 'scan_duplicate'; end if;
 if (select count(*) from public.receipt_scan_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 day')>=10
 or (select count(*) from public.receipt_scan_requests where user_id=auth.uid() and created_at>clock_timestamp()-interval '1 minute')>=2
 or (select count(*) from public.receipt_scan_requests where created_at>clock_timestamp()-interval '1 day')>=200 then raise exception 'scan_limit'; end if;
 insert into public.receipt_scan_requests(user_id,hash) values(auth.uid(),p_hash);
end; $$;
revoke all on function public.tuki_reserve_ticket(uuid,uuid,text,integer),public.tuki_reserve_scan(uuid,text) from public,anon,authenticated;
grant execute on function public.tuki_reserve_ticket(uuid,uuid,text,integer),public.tuki_reserve_scan(uuid,text) to authenticated;

-- Teach the fail-closed lifecycle guard about precisely these new tables.
create or replace function tuki_private.removal_schema_known() returns boolean
language sql stable security definer set search_path='' as $$
 select not exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','p','f') and c.relname not in
 ('profiles','persons','groups','group_members','group_invitations','group_events','expenses','expense_revisions','expense_shares','expense_people_history','obligations','expense_events','lifecycle_audit','ticket_uploads','smart_bill_revisions','receipt_scan_requests'))
 and not exists(select 1 from pg_catalog.pg_constraint c join pg_catalog.pg_class r on r.oid=c.conrelid join pg_catalog.pg_namespace n on n.oid=r.relnamespace where c.contype='f' and c.confrelid in ('public.persons'::regclass,'public.groups'::regclass,'public.group_members'::regclass) and n.nspname<>'public')
$$;
notify pgrst,'reload schema';
commit;
