// @vitest-environment node
import { readFileSync,readdirSync } from 'node:fs';
import { randomUUID,createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll,afterAll,it,expect } from 'vitest';
let db:PGlite;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const f of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(readFileSync(`supabase/migrations/${f}`,'utf8'));
},60000);
afterAll(async()=>{await db?.close();});
async function rpc<T=string>(u:string,name:string,args:unknown[]=[]):Promise<T>{return db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return(await tx.query<{v:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) v`,args)).rows[0].v;});}
async function fixture(){const a=randomUUID(),b=randomUUID();await db.query('insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())',[a,b]);const g=await rpc(a,'tuki_create_group',['Delete me','','temporary']);const token=randomUUID().replaceAll('-','').padEnd(64,'a');await rpc(a,'tuki_create_invitation',[g,createHash('sha256').update(token).digest('hex'),72]);await rpc(b,'tuki_accept_invitation',[token]);return {a,b,g,owner:await rpc(a,'tuki_ensure_person'),member:await rpc(b,'tuki_ensure_person')};}
async function expense(f:Awaited<ReturnType<typeof fixture>>,g=f.g){const id=randomUUID();await rpc(f.a,'tuki_save_expense',[id,g,0,JSON.stringify({title:'Dinner',date:'2026-11-03',category:'food',payerId:f.owner,currency:'UYU',amount:'100',rate:'1',method:'equal',shares:[{personId:f.member,input:'1'}]})]);return id;}
const rows=async(table:string,key:string,id:string)=>(await db.query<Record<string,unknown>>(`select * from ${table} where ${key}=$1`,[id])).rows;
it('requires explicit confirmation and creator authority even for another administrator',async()=>{
 const f=await fixture();await rpc(f.a,'tuki_set_member',[f.g,f.member,'admin','active']);
 await expect(rpc(f.b,'tuki_delete_group',[f.g,true])).rejects.toThrow('group_owner_required');
 await expect(rpc(f.a,'tuki_delete_group',[f.g,false])).rejects.toThrow('confirmation_required');
 expect(await rows('public.groups','id',f.g)).toHaveLength(1);
 await rpc(f.a,'tuki_archive_group',[f.g,true]);await rpc(f.a,'tuki_delete_group',[f.g,true]);
 expect(await rows('public.groups','id',f.g)).toHaveLength(0);
 await expect(rpc(f.a,'tuki_delete_group',[f.g,true])).resolves.toBe('');
 await expect(rpc(f.b,'tuki_group_deletion_status',[f.g])).rejects.toThrow('group_owner_required');
});
it('deletes exclusive financial rows and notifications atomically, retaining accounts and other groups',async()=>{
 const f=await fixture();const other=await rpc(f.a,'tuki_create_group',['Keep me','','temporary']);await expense(f);
 const id=randomUUID(),data={payerId:f.member,receiverId:f.owner,groupId:f.g,amount:'40',received:true,administrative:false,date:'2026-11-03',method:'cash',note:'',reference:'',selected:[]};
 await rpc(f.a,'tuki_create_payment',[id,JSON.stringify(data),true]);await rpc(f.b,'tuki_notification_inbox');
 await rpc(f.a,'tuki_delete_group',[f.g,true]);
 for(const table of ['expenses','expense_revisions','expense_people_history','obligations','expense_events','group_members','group_events','group_invitations','payments'])expect(await rows(`public.${table}`,'group_id',f.g)).toHaveLength(0);
 expect(await rows('public.payment_allocations','payment_id',id)).toHaveLength(0);expect(await rows('public.payment_events','payment_id',id)).toHaveLength(0);
 expect(await rows('public.groups','id',other)).toHaveLength(1);expect(await rows('public.persons','id',f.member)).toHaveLength(1);expect(await rows('auth.users','id',f.b)).toHaveLength(1);
 expect((await rows('tuki_private.payment_operations','id',id))[0]).toMatchObject({state:'cancelled',payload:null});
 await expect(rpc(f.a,'tuki_submit_prepared_payment',[id])).rejects.toThrow('operation_unavailable');
 expect((await db.query('select id from public.notifications where href=$1',[`/pagos#pago-${id}`])).rows).toHaveLength(0);
});
it('refuses mixed-origin payments without deleting any data',async()=>{
 const f=await fixture();await expense(f);const other=await rpc(f.a,'tuki_create_group',['Other origin','','temporary']);
 await db.query("insert into public.group_members(group_id,person_id) values($1,$2)",[other,f.member]);await expense(f,other);
 const id=randomUUID();await rpc(f.a,'tuki_create_payment',[id,JSON.stringify({payerId:f.member,receiverId:f.owner,groupId:f.g,amount:'150',received:true,date:'2026-11-03',method:'cash',selected:[]}),true]);
 await expect(rpc(f.a,'tuki_delete_group',[f.g,true])).rejects.toThrow('group_shared_financial_history');
 expect(await rows('public.groups','id',f.g)).toHaveLength(1);expect(await rows('public.payments','id',id)).toHaveLength(1);expect(await rows('public.expenses','group_id',f.g)).toHaveLength(1);
});
it('removes only membership without deleting a global guest shared with another group',async()=>{
 const f=await fixture(),guest=await rpc(f.a,'tuki_add_guest',[f.g,'Mati',null]);const other=await rpc(f.a,'tuki_create_group',['Other','','temporary']);await rpc(f.a,'tuki_add_guest',[other,null,guest]);
 await expect(rpc(f.b,'tuki_delete_member',[f.g,guest,true])).rejects.toThrow('group_forbidden');
 await rpc(f.a,'tuki_delete_member',[f.g,guest,true]);
 expect((await db.query('select * from public.group_members where group_id=$1 and person_id=$2',[f.g,guest])).rows).toHaveLength(0);
 expect((await db.query('select * from public.group_members where group_id=$1 and person_id=$2',[other,guest])).rows).toHaveLength(1);expect(await rows('public.persons','id',guest)).toHaveLength(1);
});
it('blocks participant financial history even after voiding, and protects the last admin and owner',async()=>{
 const f=await fixture(),id=await expense(f);await expect(rpc(f.a,'tuki_delete_member',[f.g,f.member,true])).rejects.toThrow('member_financial_history');
 await rpc(f.a,'tuki_void_expense',[id,1,true]);await expect(rpc(f.a,'tuki_delete_member',[f.g,f.member,true])).rejects.toThrow('member_financial_history');
 await expect(rpc(f.a,'tuki_delete_member',[f.g,f.owner,true])).rejects.toThrow('last_admin');await rpc(f.a,'tuki_set_member',[f.g,f.member,'admin','active']);
 await expect(rpc(f.a,'tuki_delete_member',[f.g,f.owner,true])).rejects.toThrow('group_owner_cannot_remove');
});
it('queues private files durably, restricts cleanup to service role, and acknowledges only absent objects',async()=>{
 const f=await fixture(),upload=randomUUID(),path=await rpc(f.a,'tuki_reserve_ticket',[upload,f.g,'image/png',100]);await db.query("insert into storage.objects(bucket_id,name) values('tuki-tickets',$1)",[path]);
 await rpc(f.a,'tuki_delete_group',[f.g,true]);expect(await rpc(f.a,'tuki_group_deletion_status',[f.g])).toBe(1);
 await expect(rpc(f.a,'tuki_group_file_cleanup',[f.g,[]])).rejects.toThrow('permission denied');
 const cleanup=async()=>db.transaction(async tx=>{await tx.exec('set local role service_role');return(await tx.query<{v:{remaining:number}}>('select public.tuki_group_file_cleanup($1,$2) v',[f.g,[path]])).rows[0].v;});
 expect((await cleanup()).remaining).toBe(1);await db.query('delete from storage.objects where name=$1',[path]);expect((await cleanup()).remaining).toBe(0);
});
it('fails closed on unknown domain references with the entire group intact',async()=>{
 const f=await fixture();await db.exec('create table public.future_domain(id uuid)');
 try{await expect(rpc(f.a,'tuki_delete_group',[f.g,true])).rejects.toThrow('removal_schema_changed');expect(await rows('public.groups','id',f.g)).toHaveLength(1);}finally{await db.exec('drop table public.future_domain');}
});
it('cancels prepared group intents and prevents a stale submit from resurrecting deleted movements',async()=>{
 const f=await fixture();await expense(f);const id=randomUUID();
 await rpc(f.b,'tuki_prepare_payment',[id,JSON.stringify({payerId:f.member,receiverId:f.owner,groupId:f.g,amount:'10',date:'2026-11-03',method:'cash',selected:[]}),true]);
 await expect(rpc(f.a,'tuki_delete_member',[f.g,f.member,true])).rejects.toThrow('member_financial_history');
 await rpc(f.a,'tuki_delete_group',[f.g,true]);await expect(rpc(f.b,'tuki_submit_prepared_payment',[id])).rejects.toThrow('operation_unavailable');
 expect((await rows('tuki_private.payment_operations','id',id))[0]).toMatchObject({state:'cancelled',payload:null});expect(await rows('public.payments','id',id)).toHaveLength(0);
});
it('blocks a pending balance projected from another group, without deleting either membership',async()=>{
 const f=await fixture(),other=await rpc(f.a,'tuki_create_group',['Debt origin','','temporary']);await db.query('insert into public.group_members(group_id,person_id) values($1,$2)',[other,f.member]);await expense(f,other);
 await expect(rpc(f.a,'tuki_delete_member',[f.g,f.member,true])).rejects.toThrow('member_pending_balance');
 expect((await rows('public.group_members','person_id',f.member)).filter((m:Record<string,unknown>)=>m.group_id===f.g||m.group_id===other)).toHaveLength(2);
});
it('blocks unknown external cascades from expense tables before touching financial data',async()=>{
 const f=await fixture();await expense(f);await db.exec('create schema future_domain;create table future_domain.links(expense_id uuid references public.expenses(id) on delete cascade)');
 try{await expect(rpc(f.a,'tuki_delete_group',[f.g,true])).rejects.toThrow('removal_schema_changed');expect(await rows('public.expenses','group_id',f.g)).toHaveLength(1);}finally{await db.exec('drop table future_domain.links;drop schema future_domain');}
});

it('allows the reviewed bank table while retaining global bank accounts after group deletion',async()=>{
 const f=await fixture(),account=randomUUID();await rpc(f.a,'tuki_save_bank_account',[account,JSON.stringify({bank:'BROU',holder:'Owner Name',identifier:'123456789',currency:'UYU',alias:'',is_default:true}),false]);
 await rpc(f.a,'tuki_delete_group',[f.g,true]);
 expect(await rows('public.bank_accounts','id',account)).toHaveLength(1);expect(await rows('public.persons','id',f.owner)).toHaveLength(1);
});
it('reproduces the bank table schema drift and fixes only its reviewed allowlist entry',async()=>{
 const f=await fixture();const definition=(await db.query<{definition:string}>("select pg_get_functiondef('tuki_private.removal_schema_known()'::regprocedure) definition")).rows[0].definition;
 try{await db.exec(definition.replace(",'bank_accounts'",''));await expect(rpc(f.a,'tuki_delete_group',[f.g,true])).rejects.toThrow('removal_schema_changed');expect(await rows('public.groups','id',f.g)).toHaveLength(1);}finally{await db.exec(definition);}
 await rpc(f.a,'tuki_delete_group',[f.g,true]);expect(await rows('public.groups','id',f.g)).toHaveLength(0);
});
