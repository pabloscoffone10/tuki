// @vitest-environment node
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,beforeEach,it,expect } from "vitest";
let db:PGlite,a:string,b:string,c:string,d:string;
let legacy:{user:string;id:string;data:ReturnType<typeof payload>};let invalidLegacy:{user:string;id:string;data:ReturnType<typeof payload>};
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")&&f<="202611020012_optional_admin_reason.sql").sort()){
  await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
  if(file.startsWith("202611020011")){await users();const f=await guestFixture(),id=randomUUID(),data=payload(f.payer,f.receiver,"300",f.g,true);await pay(a,data,id);await ack(a,id);legacy={user:a,id,data};await users();const bad=await guestFixture(),badId=randomUUID(),badData={...payload(bad.payer,bad.receiver,"300",bad.g,true),administrativeReason:""};await prepare(a,badId,badData);invalidLegacy={user:a,id:badId,data:badData};}
 }
},60000);
afterAll(async()=>{await db?.close();});
async function users(){a=randomUUID();b=randomUUID();c=randomUUID();d=randomUUID();await db.query("insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now()),($3,now()),($4,now())",[a,b,c,d]);}
beforeEach(users);
async function query<T=Record<string,unknown>>(u:string,sql:string,args:unknown[]=[]){return db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[u]);return tx.query<T>(sql,args);});}
async function rpc<T=string>(u:string,name:string,args:unknown[]=[]){return(await query<{v:T}>(u,`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
const person=(u:string)=>rpc(u,"tuki_ensure_person");
async function join(g:string,u:string,admin=false){const token=randomUUID().replaceAll("-","").padEnd(64,"a");await rpc(a,"tuki_create_invitation",[g,createHash("sha256").update(token).digest("hex"),72]);await rpc(u,"tuki_accept_invitation",[token]);const p=await person(u);if(admin)await rpc(a,"tuki_set_member",[g,p,"admin","active"]);return p;}
async function spend(g:string,receiver:string,payer:string,amount="800"){const id=randomUUID();await rpc(a,"tuki_save_expense",[id,g,0,JSON.stringify({title:"Private expense",date:"2026-11-02",category:"other",payerId:receiver,currency:"UYU",amount,rate:"1",method:"equal",shares:[{personId:payer,input:"1"}]})]);return id;}
async function fixture(){const g=await rpc(a,"tuki_create_group",["Piria","","permanent"]),receiver=await person(a),payer=await join(g,b),e=await spend(g,receiver,payer);return {g,receiver,payer,e};}
function payload(payer:string,receiver:string,amount="300",g:string|null=null,administrative=false){return {payerId:payer,receiverId:receiver,amount,groupId:g,administrative,administrativeReason:administrative?"Administrador declara dinero recibido":"",received:false,date:"2026-11-02",method:"cash",note:"",reference:"",selected:[]};}
const pay=(u:string,data:ReturnType<typeof payload>,id:string=randomUUID())=>rpc(u,"tuki_create_payment",[id,JSON.stringify(data),true]);
const confirm=(u:string,id:string,version=1,action="confirm",reason="",request=randomUUID())=>rpc(u,"tuki_transition_payment",[id,version,action,reason,request,true]);
type Operation={id:string;state:string;payment_status?:string;error_code?:string;summary?:{payer_name:string;receiver_name:string;amount:string;reason?:string}};
const prepare=(u:string,id:string,data:ReturnType<typeof payload>)=>rpc<Operation>(u,"tuki_prepare_payment",[id,JSON.stringify(data),true]);
const submit=(u:string,id:string)=>rpc<Operation>(u,"tuki_submit_prepared_payment",[id]);
const ack=(u:string,id:string)=>rpc(u,"tuki_ack_payment_operation",[id]);


async function guestFixture(){const f=await fixture(),guest=await rpc(a,"tuki_add_guest",[f.g,"Guest",null]);await spend(f.g,guest,f.payer);return {...f,receiver:guest};}
it("records an automatic audit statement when no additional administrative reason is provided",async()=>{
 const f=await guestFixture(),id=randomUUID(),data={...payload(f.payer,f.receiver,"300",f.g,true),administrativeReason:""};const operation=await prepare(a,id,data);expect(operation.summary?.reason).toContain("sin motivo adicional");expect((await submit(a,id)).payment_status).toBe("confirmed");const row=(await query<{reason:string;by:string;mode:string}>(a,"select administrative_reason reason,confirmed_by by,approval_mode mode from payments where id=$1",[id])).rows[0];expect(row.reason).toContain("sin motivo adicional");expect(row.by).toBe(await person(a));expect(row.mode).toBe("administrative");
});
it("accepts a one-character optional explanation without weakening database audit constraints",async()=>{
 const f=await guestFixture(),id=randomUUID(),data={...payload(f.payer,f.receiver,"300",f.g,true),administrativeReason:"X"};await prepare(a,id,data);await submit(a,id);expect((await query<{reason:string}>(a,"select administrative_reason reason from payments where id=$1",[id])).rows[0].reason).toBe("Motivo indicado: X");
});
it("retains idempotency for empty reasons through lost responses and acknowledged retries",async()=>{
 const f=await guestFixture(),id=randomUUID(),data={...payload(f.payer,f.receiver,"300",f.g,true),administrativeReason:""};await prepare(a,id,data);await submit(a,id);await prepare(a,id,data);await submit(a,id);expect((await rpc<Operation>(a,"tuki_current_payment_operation")).id).toBe(id);await ack(a,id);await pay(a,data,id);expect((await query(a,"select * from payment_allocations where payment_id=$1",[id])).rows).toHaveLength(1);await ack(a,id);await pay(a,data,randomUUID());expect((await query<{sum:string}>(a,"select sum(amount_minor)::text sum from payments where payer_id=$1 and receiver_id=$2 and status='confirmed'",[f.payer,f.receiver])).rows[0].sum).toBe("60000");
});
it("confirms an authorized pending guest payment with an optional reason",async()=>{
 const f=await guestFixture(),id=await pay(a,payload(f.payer,f.receiver,"300",f.g,false));const request=randomUUID();await confirm(a,id,1,"confirm","",request);await confirm(a,id,1,"confirm","",request);const row=(await query<{reason:string;mode:string}>(a,"select administrative_reason reason,approval_mode mode from payments where id=$1",[id])).rows[0];expect(row.reason).toContain("sin motivo adicional");expect(row.mode).toBe("administrative");expect((await query(a,"select * from payment_allocations where payment_id=$1",[id])).rows).toHaveLength(1);
});
it("cannot use an optional reason to approve another group's payment or two registered accounts",async()=>{
 const f=await guestFixture(),id=await pay(a,payload(f.payer,f.receiver,"300",f.g,false));await expect(confirm(c,id)).rejects.toThrow("payment_forbidden");const registered=await fixture(),other=await join(registered.g,c,true),pending=await pay(c,payload(registered.payer,registered.receiver,"300",registered.g,false));void other;await expect(confirm(c,pending)).rejects.toThrow("payment_receiver_required");await confirm(a,pending);
});
it("retains recipient-only direct receipt, pending recovery and rejection/void reasons",async()=>{
 const f=await fixture(),id=randomUUID(),data={...payload(f.payer,f.receiver),received:true};await prepare(a,id,data);expect((await submit(a,id)).payment_status).toBe("confirmed");expect((await query<{mode:string}>(a,"select approval_mode mode from payments where id=$1",[id])).rows[0].mode).toBe("receiver_receipt");await expect(confirm(a,id,2,"void","")).rejects.toThrow("payment_reason_required");await confirm(a,id,2,"void","Revertir cobro por error");
});
it("preserves exact payload hashes and outcomes from pre-upgrade operations",async()=>{
 await expect(pay(legacy.user,legacy.data,legacy.id)).resolves.toBe(legacy.id);expect((await query(legacy.user,"select * from payment_allocations where payment_id=$1",[legacy.id])).rows).toHaveLength(1);expect((await prepare(invalidLegacy.user,invalidLegacy.id,invalidLegacy.data)).state).toBe("prepared");expect((await submit(invalidLegacy.user,invalidLegacy.id)).error_code).toBe("payment_reason_required");
});
it("does not expose internal adapters and adds capability metadata to existing responses",async()=>{
 const g=await rpc(a,"tuki_create_group",["Capabilities","","permanent"]);expect((await rpc<{optional_admin_reason:boolean}>(a,"tuki_payment_workspace",[g])).optional_admin_reason).toBe(true);expect((await rpc<{optional_admin_reason:boolean}>(a,"tuki_notification_inbox")).optional_admin_reason).toBe(true);const rows=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tuki_private' and proname in('optional_admin_reason','prepare_payment_block1','transition_payment_block1','payment_workspace_block1','notification_inbox_block1') and(has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))");expect(rows.rows).toEqual([]);
});
it("retains the same confirmation result after the original administrator loses the role",async()=>{
 const f=await guestFixture();await join(f.g,c,true);const id=await pay(a,payload(f.payer,f.receiver,"300",f.g,false)),request=randomUUID();await confirm(a,id,1,"confirm","",request);await rpc(c,"tuki_set_member",[f.g,await person(a),"member","active"]);await expect(confirm(a,id,1,"confirm","",request)).resolves.toBe("");expect((await query(a,"select * from payment_allocations where payment_id=$1",[id])).rows).toHaveLength(1);await expect(confirm(a,id,1,"confirm","Otra explicación",request)).rejects.toThrow("payment_idempotency_conflict");
});
