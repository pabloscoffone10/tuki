// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,beforeEach,it,expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createReportCsv,createReportPdf,exportPayloadSchema } from '@/features/reports/export';
let db:PGlite,a:string,b:string,c:string;
type Payload=ReturnType<typeof expenseData>;
let legacy:{user:string;group:string;receiver:string;payer:string;readId:string;readData:Payload;editId:string;editData:Payload;smartId:string;smartData:Payload;paymentId:string;paymentData:Record<string,unknown>};
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&f<='202611020013_reporting.sql').sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
 await users();const group=await rpc(a,'tuki_create_group',['Histórico','','permanent']),receiver=await person(a),payer=await join(group,b);
 const readId=randomUUID(),editId=randomUUID(),smartId=randomUUID(),readData=expenseData(receiver,[receiver,payer],{currency:'USD',rate:'40',amount:'20'}),editData=expenseData(receiver,[receiver,payer],{currency:'EUR',rate:'42',amount:'10'}),smartData=expenseData(receiver,[],{currency:'USD',rate:'40',smartBill:bill(payer,'USD','40')});
 for(const [id,data] of [[readId,readData],[editId,editData],[smartId,smartData]] as const)await save(a,id,group,0,data);
 const guest=await rpc(a,'tuki_add_guest',[group,'Legacy guest',null]);await save(a,randomUUID(),group,0,expenseData(receiver,[guest]));
 const paymentData={...paymentPayload(guest,receiver,group),currency:'USD',rate:'40'},paymentId=randomUUID();await rpc(a,'tuki_create_payment',[paymentId,JSON.stringify(paymentData),true]);await rpc(a,'tuki_ack_payment_operation',[paymentId]);
 legacy={user:a,group,receiver,payer,readId,readData,editId,editData,smartId,smartData,paymentId,paymentData};
 await db.exec(readFileSync('supabase/migrations/202611020014_beta_uyu.sql','utf8'));
},60000);
afterAll(async()=>{await db?.close();});
async function users(){a=randomUUID();b=randomUUID();c=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now()),($3,now())',[a,b,c]);}
beforeEach(users);
async function rpc<T=string>(u:string,name:string,args:unknown[]=[]):Promise<T>{return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return(await tx.query<{v:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) v`,args)).rows[0].v;});}
const person=(u:string)=>rpc(u,'tuki_ensure_person');
async function join(g:string,u:string){const token=randomUUID().replaceAll('-','').padEnd(64,'a');await rpc(a,'tuki_create_invitation',[g,createHash('sha256').update(token).digest('hex'),72]);await rpc(u,'tuki_accept_invitation',[token]);return person(u);}
async function fixture(){const group=await rpc(a,'tuki_create_group',['Beta UYU','','temporary']),receiver=await person(a),payer=await join(group,b);return {group,receiver,payer};}
function expenseData(payer:string,consumers:string[],extra:Record<string,unknown>={}){return {title:'Beta expense',date:'2026-11-02',category:'food',payerId:payer,currency:'UYU',amount:'100.01',rate:'1',method:'equal',shares:consumers.map(personId=>({personId,input:'1'})),...extra};}
const save=(user:string,id:string,group:string,version:number,data:Payload)=>rpc(user,'tuki_save_expense',[id,group,version,JSON.stringify(data)]);
function bill(consumer:string,currency='UYU',rate='1'){return {currency,rate,items:[{id:randomUUID(),name:'Cena',quantity:'1',priceMode:'subtotal',price:'20',discount:'0',split:'equal',consumers:[{personId:consumer,input:'1'}],reviewed:true}],adjustments:[],ticketTotal:'20',noTotalReason:'',confirmed:true,uploadId:null};}
function paymentPayload(payer:string,receiver:string,group:string){return {payerId:payer,receiverId:receiver,amount:'20',groupId:group,received:true,administrative:false,administrativeReason:'',date:'2026-11-03',method:'cash',note:'',reference:'',selected:[]};}
it('creates UYU expenses with an exact remainder and no new conversion',async()=>{
 const f=await fixture(),id=randomUUID();await save(a,id,f.group,0,expenseData(f.receiver,[f.receiver,f.payer]));const detail=await rpc<{currency:string;rate:string;original_minor:string;total_minor:string;shares:{amount_minor:string}[]}>(a,'tuki_expense_detail',[id]);expect(detail.currency).toBe('UYU');expect(BigInt(detail.total_minor)).toBe(10001n);expect(detail.original_minor).toBe('10001');expect(detail.shares.reduce((sum,row)=>sum+BigInt(row.amount_minor),0n)).toBe(10001n);expect(detail.shares.map(s=>s.amount_minor).sort()).toEqual(['5000','5001']);
});
it.each(['USD','EUR','ARS'])('rejects a new %s expense through the public SQL RPC, including backdated requests',async currency=>{
 const f=await fixture();await expect(save(a,randomUUID(),f.group,0,expenseData(f.receiver,[f.payer],{currency,rate:'40',date:'2020-01-01'}))).rejects.toThrow('beta_currency_uyu_only');expect((await db.query('select id from expenses where group_id=$1',[f.group])).rows).toHaveLength(0);
});
it('rejects a non-unit UYU rate and a foreign smart-bill currency',async()=>{
 const f=await fixture();await expect(save(a,randomUUID(),f.group,0,expenseData(f.receiver,[f.payer],{rate:'2'}))).rejects.toThrow('beta_currency_uyu_only');await expect(save(a,randomUUID(),f.group,0,expenseData(f.receiver,[],{smartBill:bill(f.payer,'USD','40')}))).rejects.toThrow('beta_currency_uyu_only');
 const id=randomUUID();await save(a,id,f.group,0,expenseData(f.receiver,[],{smartBill:bill(f.payer)}));expect((await rpc<{currency:string;total_minor:string}>(a,'tuki_expense_detail',[id])).currency).toBe('UYU');
});
it('retains authorized foreign history and exports its stored conversion without rewriting it',async()=>{
 const detail=await rpc<{currency:string;rate:string;original_minor:string;total_minor:string}>(legacy.user,'tuki_expense_detail',[legacy.readId]);expect(detail).toMatchObject({currency:'USD',original_minor:'2000',total_minor:'80000'});expect(Number(detail.rate)).toBe(40);
 const report=await rpc<{expenses:{id:string;currency:string;original_minor:string;total_minor:string}[];statistics:{currencies:{currency:string;original_minor:string;total_minor:string}[]}}>(legacy.user,'tuki_group_export',[legacy.group,null,null]);expect(report.expenses.find(e=>e.id===legacy.readId)).toMatchObject({currency:'USD',original_minor:'2000',total_minor:'80000'});expect(report.statistics.currencies.some(row=>row.currency==='USD')).toBe(true);expect(report.statistics.currencies.some(row=>row.currency==='EUR')).toBe(true);
});
it('allows an old create retry but refuses changing its payload under the same ID',async()=>{
 await expect(save(legacy.user,legacy.readId,legacy.group,0,legacy.readData)).resolves.toBe(legacy.readId);await expect(save(legacy.user,legacy.readId,legacy.group,0,{...legacy.readData,currency:'EUR'})).rejects.toThrow('expense_conflict');
});
it('allows historical corrections at the stored currency and rate, preserving immutable prior versions',async()=>{
 await expect(save(legacy.user,legacy.editId,legacy.group,1,{...legacy.editData,title:'Corrected historical note',rate:'42.000000',amount:'11'})).resolves.toBe(legacy.editId);const rows=await db.query<{version:number;currency:string;rate:string;original:string}>('select version,original_currency currency,exchange_rate::text rate,original_minor::text original from expense_revisions where expense_id=$1 order by version',[legacy.editId]);expect(rows.rows).toHaveLength(2);expect(rows.rows[0]).toMatchObject({version:1,currency:'EUR',original:'1000'});expect(rows.rows[1]).toMatchObject({version:2,currency:'EUR',original:'1100'});
 await expect(save(legacy.user,legacy.editId,legacy.group,2,{...legacy.editData,rate:'43'})).rejects.toThrow('beta_historical_currency_locked');await expect(save(legacy.user,legacy.editId,legacy.group,2,{...legacy.editData,currency:'UYU',rate:'1'})).rejects.toThrow('beta_historical_currency_locked');
});
it('preserves historical smart documents and their original fixed currency',async()=>{
 const current=await rpc<{version:number}>(legacy.user,'tuki_expense_detail',[legacy.smartId]);const documents=await db.query<{document:{currency:string;rate:string}}>('select document from smart_bill_revisions s join expense_revisions r on r.id=s.revision_id where r.expense_id=$1',[legacy.smartId]);expect(documents.rows[0].document.currency).toBe('USD');await expect(save(legacy.user,legacy.smartId,legacy.group,0,legacy.smartData)).resolves.toBe(legacy.smartId);await expect(save(legacy.user,legacy.smartId,legacy.group,current.version,{...legacy.smartData,title:'Historical smart edit'})).resolves.toBe(legacy.smartId);const changed={...legacy.smartData,smartBill:bill(legacy.payer,'EUR','40')};await expect(save(legacy.user,legacy.smartId,legacy.group,2,changed)).rejects.toThrow('beta_historical_currency_locked');
});
it('does not reveal historical currency before authorization and cannot convert a UYU expense',async()=>{
 await expect(save(a,legacy.readId,legacy.group,1,legacy.readData)).rejects.toThrow('group_forbidden');const f=await fixture(),id=randomUUID();await save(a,id,f.group,0,expenseData(f.receiver,[f.payer]));await expect(save(a,id,f.group,1,expenseData(f.receiver,[f.payer],{currency:'USD',rate:'40'}))).rejects.toThrow('beta_historical_currency_locked');
});
it('rejects declared foreign payments through prepare and direct create without recording an intent',async()=>{
 const f=await fixture();await save(a,randomUUID(),f.group,0,expenseData(f.receiver,[f.payer]));for(const extra of [{currency:'USD'},{originalCurrency:'EUR'},{original_currency:'USD'},{currency:null},{rate:'2'}]){
  const id=randomUUID(),data={...paymentPayload(f.payer,f.receiver,f.group),...extra};await expect(rpc(a,'tuki_prepare_payment',[id,JSON.stringify(data),true])).rejects.toThrow('beta_currency_uyu_only');await expect(rpc(a,'tuki_create_payment',[id,JSON.stringify(data),true])).rejects.toThrow('beta_currency_uyu_only');expect((await db.query('select id from tuki_private.payment_operations where id=$1',[id])).rows).toEqual([]);
 }
 const id=randomUUID();await expect(rpc(a,'tuki_create_payment',[id,JSON.stringify(paymentPayload(f.payer,f.receiver,f.group)),true])).resolves.toBe(id);expect((await db.query<{amount:string}>('select amount_minor::text amount from payments where id=$1',[id])).rows[0].amount).toBe('2000');
});
it('retains the original UYU payment and idempotency hashes from pre-policy requests',async()=>{
 await expect(rpc(legacy.user,'tuki_create_payment',[legacy.paymentId,JSON.stringify(legacy.paymentData),true])).resolves.toBe(legacy.paymentId);expect((await db.query('select * from payment_allocations where payment_id=$1',[legacy.paymentId])).rows).toHaveLength(1);await expect(rpc(legacy.user,'tuki_prepare_payment',[legacy.paymentId,JSON.stringify({...legacy.paymentData,currency:'EUR'}),true])).rejects.toThrow('payment_idempotency_conflict');
});
it('does not grant direct access to the old engines or anonymous beta entry points',async()=>{
 const exposed=await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tuki_private' and p.proname in('save_expense_before_beta','prepare_payment_before_beta') and(has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))");expect(exposed.rows).toEqual([]);for(const signature of ['public.tuki_save_expense(uuid,uuid,integer,jsonb)','public.tuki_prepare_payment(uuid,jsonb,boolean)']){const result=await db.query<{anonymous:boolean;authed:boolean;config:string[]}>("select has_function_privilege('anon',$1,'execute') anonymous,has_function_privilege('authenticated',$1,'execute') authed,(select proconfig from pg_proc where oid=$1::regprocedure) config",[signature]);expect(result.rows[0]).toMatchObject({anonymous:false,authed:true});expect(result.rows[0].config).toContain('search_path=""');}
});
it('integrates the four-person UYU padel scenario through expenses, confirmations, rejection, history, notifications and exports',async()=>{
 const f=await fixture(),pc=await join(f.group,c),d=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[d]);const pd=await join(f.group,d),expenseId=randomUUID();await save(a,expenseId,f.group,0,expenseData(f.receiver,[f.receiver,f.payer,pc,pd],{title:'Pádel cuatro amigos',amount:'1000',category:'sports'}));
 async function request(user:string,payer:string,amount:string){const id=randomUUID(),data={...paymentPayload(payer,f.receiver,f.group),amount,received:false};await rpc(user,'tuki_create_payment',[id,JSON.stringify(data),true]);await rpc(user,'tuki_ack_payment_operation',[id]);return id;}
 async function transition(id:string,action:string,reason=''){await rpc(a,'tuki_transition_payment',[id,1,action,reason,randomUUID(),true]);}
 const full=await request(b,f.payer,'250');await transition(full,'confirm');const partial=await request(c,pc,'100');await transition(partial,'confirm');const rejected=await request(d,pd,'200');await transition(rejected,'reject','El dinero todavía no fue recibido');await request(d,pd,'50');
 const report=exportPayloadSchema.parse(await rpc(a,'tuki_group_export',[f.group,null,null]));expect(report.statistics).toMatchObject({expense_count:1,total_minor:'100000',confirmed_minor:'35000',outstanding_minor:'40000',pending_payment_count:1});expect(report.expenses[0].participants.every(p=>p.amount_minor==='25000')).toBe(true);expect(report.statistics.people.find(p=>p.person_id===f.receiver)).toMatchObject({advanced_minor:'100000',consumed_minor:'25000',settled_received_minor:'35000',balance_minor:'40000'});expect(report.statistics.people.find(p=>p.person_id===pc)?.balance_minor).toBe('-15000');expect(report.statistics.people.find(p=>p.person_id===pd)?.balance_minor).toBe('-25000');expect(report.statistics.people.reduce((sum,p)=>sum+BigInt(p.balance_minor),0n)).toBe(0n);
 const history=await rpc<{total:number;items:{entity:string;kind:string;status:string}[]}>(a,'tuki_history_page',[f.group,null,null,1,25]);expect(history.total).toBe(8);expect(history.items.filter(e=>e.entity==='payment'&&e.kind==='confirm')).toHaveLength(2);expect(history.items.some(e=>e.kind==='reject'&&e.status==='rejected')).toBe(true);
 const inbox=await rpc<{items:{kind:string}[]}>(a,'tuki_notification_inbox');expect(inbox.items.some(n=>n.kind==='confirmation_requested')).toBe(true);expect(inbox.items.some(n=>n.kind==='payment_rejected')).toBe(true);const payerInbox=await rpc<{items:{kind:string}[]}>(b,'tuki_notification_inbox');expect(payerInbox.items.some(n=>n.kind==='debt_settled')).toBe(true);
 const personal=await rpc<{owe_minor:string;owed_minor:string}>(c,'tuki_personal_statistics',[null,null]);expect(personal).toMatchObject({owe_minor:'15000',owed_minor:'0'});expect(createReportCsv(report)).toContain('"Total de gastos UYU";"1000,00"');expect(createReportCsv(report)).toContain('"Liquidado UYU";"350,00"');expect((await PDFDocument.load(await createReportPdf(report))).getPageCount()).toBeGreaterThan(0);
});
