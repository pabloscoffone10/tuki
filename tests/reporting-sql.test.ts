// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,beforeEach,it,expect } from 'vitest';
import { exportPayloadSchema } from '@/features/reports/export';
let db:PGlite,a:string,b:string,c:string;
type Stats={total_minor:string;confirmed_minor:string;outstanding_minor:string;expense_count:number;pending_payment_count:number;people:{person_id:string;advanced_minor:string;consumed_minor:string;balance_minor:string;display_name:string}[];currencies:{currency:string;original_minor:string;total_minor:string}[];timeline:{date:string;total_minor:string}[]};
type Page={items:{id:string;title:string;total_minor:string;payer_name:string;created_at:string;status:string;kind:string;entity:string;amount_minor:string;actor_name:string}[];total:number;page:number;size:number;options:{people:{id:string;name:string}[]}};
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<='202611020013_reporting.sql').sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
},60000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{a=randomUUID();b=randomUUID();c=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values($1,now(),$4),($2,now(),$5),($3,now(),$6)',[a,b,c,JSON.stringify({display_name:'Pablo'}),JSON.stringify({display_name:'Mati'}),JSON.stringify({display_name:'Facu'})]);});
async function rpc<T=string>(u:string,name:string,args:unknown[]=[]):Promise<T>{return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return(await tx.query<{v:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) v`,args)).rows[0].v;});}
const person=(u:string)=>rpc(u,'tuki_ensure_person');
async function join(g:string,u:string){const token=randomUUID().replaceAll('-','').padEnd(64,'a');await rpc(a,'tuki_create_invitation',[g,createHash('sha256').update(token).digest('hex'),72]);await rpc(u,'tuki_accept_invitation',[token]);return person(u);}
async function expense(g:string,payer:string,consumers:string[],amount='100',date='2026-11-02',currency='UYU',rate='1',title='Cena'){const id=randomUUID();await rpc(a,'tuki_save_expense',[id,g,0,JSON.stringify({title,date,category:'food',payerId:payer,currency,amount,rate,method:'equal',shares:consumers.map(personId=>({personId,input:'1'}))})]);return id;}
async function fixture(){const g=await rpc(a,'tuki_create_group',['Juana','','permanent']);const pa=await person(a),pb=await join(g,b);const e=await expense(g,pa,[pa,pb]);return{g,pa,pb,e};}
const statistics=(u:string,g:string,from:string|null=null,to:string|null=null)=>rpc<Stats>(u,'tuki_group_statistics',[g,from,to]);
const page=(u:string,g:string|null,filters:Record<string,unknown>={},n=1,size=25)=>rpc<Page>(u,'tuki_expenses_page',[g,JSON.stringify(filters),n,size]);
async function payment(f:Awaited<ReturnType<typeof fixture>>,amount='20',received=true){const id=randomUUID();await rpc(a,'tuki_create_payment',[id,JSON.stringify({payerId:f.pb,receiverId:f.pa,amount,groupId:f.g,received,administrative:false,administrativeReason:'',date:'2026-11-03',method:'cash',note:'',reference:'',selected:[]}),true]);await rpc(a,'tuki_ack_payment_operation',[id]);return id;}
it('separates advances, consumption and partial settlements without adding payments to expenses',async()=>{
 const f=await fixture();const id=await payment(f);const s=await statistics(a,f.g);expect(s.total_minor).toBe('10000');expect(s.expense_count).toBe(1);expect(s.confirmed_minor).toBe('2000');expect(s.outstanding_minor).toBe('3000');expect(s.people.find(p=>p.person_id===f.pa)).toMatchObject({advanced_minor:'10000',consumed_minor:'5000',balance_minor:'3000'});expect(s.people.find(p=>p.person_id===f.pb)).toMatchObject({advanced_minor:'0',consumed_minor:'5000',balance_minor:'-3000'});
 await rpc(a,'tuki_transition_payment',[id,2,'void','Se registró por error',randomUUID(),true]);expect((await statistics(a,f.g)).confirmed_minor).toBe('0');expect((await statistics(a,f.g)).outstanding_minor).toBe('5000');
});
it('does not treat a pending request as paid and counts only visible origin-context requests',async()=>{
 const f=await fixture();await payment(f,'20',false);const s=await statistics(a,f.g);expect(s.pending_payment_count).toBe(1);expect(s.confirmed_minor).toBe('0');expect(s.outstanding_minor).toBe('5000');
});
it('never includes Piria expenses in Juana despite a shared projected obligation',async()=>{
 const f=await fixture(),other=await rpc(a,'tuki_create_group',['Piria Halloween','','temporary']);await join(other,b);const pc=await join(other,c);await expense(other,f.pa,[f.pb,pc],'900','2026-11-02','UYU','1','Privado de Piria');const juana=await statistics(b,f.g);expect(juana.total_minor).toBe('10000');expect(JSON.stringify(juana)).not.toContain('Privado de Piria');const filtered=await page(b,f.g,{participant:pc});expect(filtered.total).toBe(0);await expect(statistics(c,f.g)).rejects.toThrow('group_forbidden');await expect(rpc(c,'tuki_group_export',[f.g,null,null])).rejects.toThrow('group_forbidden');
});
it('rejects outsiders, retired members and anonymous reads without widening existing permissions',async()=>{
 const f=await fixture();await expect(statistics(c,f.g)).rejects.toThrow('group_forbidden');await rpc(a,'tuki_set_member',[f.g,f.pb,'member','retired']);await expect(statistics(b,f.g)).rejects.toThrow('group_forbidden');await expect(page(b,f.g)).rejects.toThrow('group_forbidden');expect((await statistics(a,f.g)).people.find(p=>p.person_id===f.pb)?.display_name).toBe('Mati');
 await expect(db.transaction(async tx=>{await tx.exec('set local role anon');return tx.query('select public.tuki_group_statistics($1,null,null)',[f.g]);})).rejects.toThrow('permission denied');
});
it('retains original currency subtotals and uses stored UYU conversions',async()=>{
 const f=await fixture();await expense(f.g,f.pa,[f.pa,f.pb],'2','2026-12-01','USD','40');const s=await statistics(a,f.g);expect(s.total_minor).toBe('18000');expect(s.currencies).toEqual([{currency:'USD',original_minor:'200',total_minor:'8000'},{currency:'UYU',original_minor:'10000',total_minor:'10000'}]);expect((await statistics(a,f.g,'2026-12-01','2026-12-31')).total_minor).toBe('8000');expect(s.timeline).toHaveLength(2);
});
it('applies server filters and deterministic pagination without exposing another group',async()=>{
 const f=await fixture();await expense(f.g,f.pb,[f.pa,f.pb],'30','2026-11-04','UYU','1','Taxi');await expense(f.g,f.pa,[f.pa],'20','2026-11-05','USD','40','Hotel');const first=await page(a,f.g,{sort:'amount_desc'},1,1),second=await page(a,f.g,{sort:'amount_desc'},2,1);expect(first.total).toBe(3);expect(first.items[0].title).toBe('Hotel');expect(second.items[0].title).toBe('Cena');expect((await page(a,f.g,{q:'tax',payer:f.pb,participant:f.pa,currency:'UYU',min_minor:'2000',max_minor:'4000',category:'food'})).items.map(i=>i.title)).toEqual(['Taxi']);expect((await page(a,f.g,{q:'%'})).total).toBe(0);await expect(page(a,f.g,{sort:'drop table'})).rejects.toThrow('invalid_report_filters');await expect(page(a,f.g,{},1,101)).rejects.toThrow('invalid_report_page');await expect(statistics(a,f.g,'2026-12-01','2026-01-01')).rejects.toThrow('invalid_report_period');
});
it('returns only registered expense and payment events with their event-time state and amount',async()=>{
 const f=await fixture(),id=await payment(f);await rpc(a,'tuki_transition_payment',[id,2,'void','Reversión por error',randomUUID(),true]);const history=await rpc<Page>(a,'tuki_history_page',[f.g,null,null,1,2]);expect(history.total).toBe(4);expect(history.items).toHaveLength(2);expect(history.items[0]).toMatchObject({entity:'payment',kind:'void',status:'void',amount_minor:'2000'});expect(history.items[1]).toMatchObject({entity:'payment',kind:'confirm',status:'confirmed'});expect((await rpc<Page>(a,'tuki_history_page',[f.g,null,null,2,2])).items).toHaveLength(2);await expect(rpc(c,'tuki_history_page',[f.g,null,null,1,25])).rejects.toThrow('group_forbidden');
});
it('exports a bounded origin-only snapshot and excludes receipts, notes and unrelated projections',async()=>{
 const f=await fixture();const report=await rpc<{statistics:Stats;expenses:Page['items']}>(a,'tuki_group_export',[f.g,null,null]);expect(report.statistics.total_minor).toBe('10000');expect(report.expenses).toHaveLength(1);expect(report.expenses[0].id).toBe(f.e);expect(JSON.stringify(report)).not.toMatch(/receipt_data|notes|request_hash|revision_id/);expect((await rpc<{statistics:Stats;expenses:unknown[]}>(a,'tuki_group_export',[f.g,'2020-01-01','2020-01-02'])).expenses).toEqual([]);
});
it('fails closed on oversized exports instead of silently truncating',async()=>{
 const f=await fixture();await db.query(`with new as(insert into public.expenses(id,group_id,created_by,version,request_hash) select gen_random_uuid(),$1,$2,1,'fixture' from generate_series(1,1000) returning id)
 insert into public.expense_revisions(expense_id,group_id,version,title,notes,category,expense_date,payer_id,original_currency,original_minor,exchange_rate,total_minor,split_method,actor_id)
 select id,$1,1,'Fixture','','other','2026-11-02',$2,'UYU',1,1,1,'equal',$2 from new`,[f.g,f.pa]);await expect(rpc(a,'tuki_group_export',[f.g,null,null])).rejects.toThrow('report_export_limit');
});
it('deduplicates personal balances across shared groups and omits inaccessible expense details',async()=>{
 const f=await fixture(),g2=await rpc(a,'tuki_create_group',['Piria','','temporary']);await join(g2,b);await expense(g2,f.pa,[f.pa,f.pb],'40');await payment(f);const s=await rpc<{owe_minor:string;owed_minor:string;advanced_minor:string;consumed_minor:string;confirmed_received_minor:string;expense_count:number}>(a,'tuki_personal_statistics',[null,null]);expect(s.owed_minor).toBe('5000');expect(s.owe_minor).toBe('0');expect(s.advanced_minor).toBe('14000');expect(s.consumed_minor).toBe('7000');expect(s.confirmed_received_minor).toBe('2000');expect(s.expense_count).toBe(2);await rpc(a,'tuki_set_member',[g2,f.pb,'member','retired']);const bstats=await rpc<{owe_minor:string;expense_count:number}>(b,'tuki_personal_statistics',[null,null]);expect(bstats.owe_minor).toBe('5000');expect(bstats.expense_count).toBe(1);
});
it('keeps new helpers private and public RPCs authenticated-only with empty search paths',async()=>{
 const internal=await db.query("select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tuki_private' and p.proname='report_guard' and(has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))");expect(internal.rows).toEqual([]);const publicRpc=await db.query<{proname:string;proconfig:string[];provolatile:string}>("select proname,proconfig,provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('tuki_group_statistics','tuki_expenses_page','tuki_history_page','tuki_group_export','tuki_personal_statistics')");expect(publicRpc.rows).toHaveLength(5);for(const row of publicRpc.rows){expect(row.proconfig).toContain('search_path=""');expect(row.provolatile).toBe('s');}
});
it('validates a real authorized SQL export against the server document schema',async()=>{
 const f=await fixture();await payment(f);const payload=await rpc(a,'tuki_group_export',[f.g,null,null]);expect(exportPayloadSchema.safeParse(payload).success).toBe(true);const s=await statistics(a,f.g);expect(s.people.reduce((sum,p)=>sum+BigInt(p.balance_minor),0n)).toBe(0n);expect(BigInt(s.confirmed_minor)+BigInt(s.outstanding_minor)).toBe(5000n);
});
it('preserves archived access while keeping retired identity names masked for ordinary viewers',async()=>{
 const f=await fixture(),pc=await join(f.g,c);await expense(f.g,pc,[f.pb],'30');await rpc(a,'tuki_set_member',[f.g,pc,'member','retired']);const s=await statistics(b,f.g);expect(s.people.find(p=>p.person_id===pc)?.display_name).toBe('Participante histórico');expect(JSON.stringify(await page(b,f.g,{payer:pc}))).not.toContain('Facu');await rpc(a,'tuki_archive_group',[f.g,true]);expect((await statistics(b,f.g)).total_minor).toBe('13000');expect(exportPayloadSchema.safeParse(await rpc(b,'tuki_group_export',[f.g,null,null])).success).toBe(true);
});
it('rejects unconfirmed identities and works inside a read-only transaction',async()=>{
 const f=await fixture();await db.query('update auth.users set email_confirmed_at=null where id=$1',[b]);await expect(statistics(b,f.g)).rejects.toThrow('authentication_required');await db.transaction(async tx=>{await tx.exec('set transaction read only; set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[a]);const result=await tx.query<{v:Stats}>('select public.tuki_group_statistics($1,null,null) v',[f.g]);expect(result.rows[0].v.total_minor).toBe('10000');});
});
