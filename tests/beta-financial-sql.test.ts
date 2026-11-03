// @vitest-environment node
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,beforeEach,it,expect } from "vitest";
let db:PGlite,a:string,b:string,c:string,d:string;
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")&&f<="202611020010_financial_integrity.sql").sort()){
  await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
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
const pay=(u:string,data:ReturnType<typeof payload>,id=randomUUID())=>rpc(u,"tuki_create_payment",[id,JSON.stringify(data),true]);
const confirm=(u:string,id:string,version=1,action="confirm",reason="",request=randomUUID())=>rpc(u,"tuki_transition_payment",[id,version,action,reason,request,true]);
type Operation={id:string;state:string;payment_status?:string;error_code?:string;summary?:{payer_name:string;receiver_name:string;amount:string}};
const prepare=(u:string,id:string,data:ReturnType<typeof payload>)=>rpc<Operation>(u,"tuki_prepare_payment",[id,JSON.stringify(data),true]);
const submit=(u:string,id:string)=>rpc<Operation>(u,"tuki_submit_prepared_payment",[id]);
const ack=(u:string,id:string)=>rpc(u,"tuki_ack_payment_operation",[id]);
type PairState={payer_id:string;receiver_id:string;state:string;remaining_minor:string|null;scope:string;pending_payment:boolean};
const workspace=(u:string,g?:string)=>rpc<{operation_protocol:boolean;pair_states:PairState[]}>(u,"tuki_payment_workspace",[g??null]);

it("recovers a committed 300 UYU payment after a lost response without a second allocation",async()=>{
 const f=await fixture(),id=randomUUID(),data={...payload(f.payer,f.receiver),received:true};
 expect((await prepare(a,id,data)).state).toBe("prepared");await submit(a,id); // Deliberately discard the HTTP result.
 const recovered=await rpc<Operation>(a,"tuki_current_payment_operation");expect(recovered).toMatchObject({id,state:"processed",payment_status:"confirmed",summary:{amount:"300"}});
 await submit(a,id);expect((await query(a,"select * from payment_allocations where payment_id=$1",[id])).rows).toHaveLength(1);
 await expect(prepare(a,randomUUID(),data)).rejects.toThrow("operation_unresolved");
 await ack(a,id);const second=randomUUID();await prepare(a,second,data);await submit(a,second);
 expect((await query<{sum:string}>(a,"select sum(amount_minor)::text sum from payments where id in($1,$2)",[id,second])).rows[0].sum).toBe("60000");
});
it("keeps a prepared operation across reads, refuses replacement and never stores its private payload publicly",async()=>{
 const f=await fixture(),id=randomUUID(),data=payload(f.payer,f.receiver);
 await prepare(b,id,data);expect((await rpc<Operation>(b,"tuki_current_payment_operation")).id).toBe(id);
 await expect(prepare(b,randomUUID(),data)).rejects.toThrow("operation_unresolved");
 await expect(prepare(b,id,{...data,amount:"301"})).rejects.toThrow("payment_idempotency_conflict");
 const operation=await rpc<Operation&{payload?:unknown}>(b,"tuki_payment_operation",[id]);expect(operation.payload).toBeUndefined();expect(operation.summary?.amount).toBe("300");
 expect((await query(b,"select * from notifications where event_key like 'operation:%'" )).rows).toHaveLength(0);
});
it("preparing guessed IDs is not an oracle for foreign names and acknowledgment clears private draft data",async()=>{
 const f=await fixture(),foreignGroup=await rpc(c,"tuki_create_group",["Secret group","","permanent"]),foreign=await rpc(c,"tuki_add_guest",[foreignGroup,"Private identity",null]),id=randomUUID();
 const operation=await prepare(b,id,payload(f.payer,foreign,"300",null));expect(operation.summary?.receiver_name).toBe("Participante");expect(JSON.stringify(operation)).not.toContain("Private identity");
 expect((await submit(b,id)).state).toBe("rejected");await ack(b,id);
 const saved=(await db.query<{payload:unknown}>("select payload from tuki_private.payment_operations where id=$1",[id])).rows[0];expect(saved.payload).toBeNull();
});
it("cancels only an unsent operation and a late retry cannot create a payment",async()=>{
 const f=await fixture(),id=randomUUID();await prepare(b,id,payload(f.payer,f.receiver));await rpc(b,"tuki_cancel_payment_operation",[id]);
 expect(await rpc(b,"tuki_current_payment_operation")).toBeNull();await expect(submit(b,id)).rejects.toThrow("operation_unavailable");expect((await query(b,"select * from payments where id=$1",[id])).rows).toHaveLength(0);
 await expect(prepare(b,id,payload(f.payer,f.receiver))).rejects.toThrow("operation_cancelled");
});
it("a definite rejection is recoverable, does not change money, and requires acknowledgement",async()=>{
 const f=await fixture(),id=randomUUID();await prepare(b,id,payload(f.payer,f.receiver,"900"));
 expect(await submit(b,id)).toMatchObject({state:"rejected",error_code:"payment_over_amount"});expect((await query(b,"select * from payments where id=$1",[id])).rows).toHaveLength(0);
 expect((await submit(b,id)).state).toBe("rejected");await ack(b,id);expect(await rpc(b,"tuki_current_payment_operation")).toBeNull();
});
it("blocks foreign lookups, submissions and private-table reads and grants no anon entry points",async()=>{
 const f=await fixture(),id=randomUUID();await prepare(b,id,payload(f.payer,f.receiver));
 expect(await rpc(a,"tuki_payment_operation",[id])).toBeNull();expect(await rpc(c,"tuki_current_payment_operation")).toBeNull();
 await expect(submit(a,id)).rejects.toThrow("operation_unavailable");await expect(ack(a,id)).rejects.toThrow("operation_unavailable");await expect(query(b,"select * from tuki_private.payment_operations")).rejects.toThrow("permission denied");
 const row=(await db.query<{anon:boolean;auth:boolean}>("select has_function_privilege('anon','public.tuki_prepare_payment(uuid,jsonb,boolean)','execute') anon,has_function_privilege('authenticated','public.tuki_prepare_payment(uuid,jsonb,boolean)','execute') auth")).rows[0];expect(row).toEqual({anon:false,auth:true});
});
it("the legacy create RPC cannot bypass the unresolved-operation gate",async()=>{
 const f=await fixture(),id=randomUUID();await prepare(b,id,payload(f.payer,f.receiver));await expect(pay(b,payload(f.payer,f.receiver))).rejects.toThrow("operation_unresolved");
 expect(await pay(b,payload(f.payer,f.receiver),id)).toBe(id);expect((await submit(b,id)).payment_status).toBe("pending");await expect(rpc(b,"tuki_cancel_payment_operation",[id])).rejects.toThrow("operation_unresolved");
});
it("authorizations are checked again at submission after a role change",async()=>{
 const f=await fixture(),guest=await rpc(a,"tuki_add_guest",[f.g,"Guest",null]);await spend(f.g,f.receiver,guest);const admin=await join(f.g,c,true),id=randomUUID();
 await prepare(c,id,payload(guest,f.receiver,"300",f.g,true));await rpc(a,"tuki_set_member",[f.g,admin,"member","active"]);
 expect(await submit(c,id)).toMatchObject({state:"rejected",error_code:"payment_admin_not_allowed"});expect((await query(a,"select * from payment_allocations where payment_id=$1",[id])).rows).toHaveLength(0);
});
it("explicit ledger states distinguish pending, partial and settled amounts",async()=>{
 const f=await fixture();expect((await workspace(a)).pair_states[0]).toMatchObject({state:"pending",remaining_minor:"80000",scope:"global"});
 const one=await pay(a,{...payload(f.payer,f.receiver),received:true});await ack(a,one);expect((await workspace(a)).pair_states[0]).toMatchObject({state:"partial",remaining_minor:"50000"});
 await pay(a,{...payload(f.payer,f.receiver,"500"),received:true});expect((await workspace(a)).pair_states[0]).toMatchObject({state:"settled",remaining_minor:"0"});
});
it("shows a pending confirmation separately from an unchanged debt",async()=>{
 const f=await fixture();await pay(b,payload(f.payer,f.receiver));expect((await workspace(a)).pair_states[0]).toMatchObject({state:"pending",remaining_minor:"80000",pending_payment:true});
});
it("a historical payment does not establish a zero balance when a viewer loses projection authority",async()=>{
 const f=await fixture(),admin=await join(f.g,c,true);const id=await pay(c,payload(f.payer,f.receiver,"300",f.g));await confirm(a,id);
 await rpc(a,"tuki_set_member",[f.g,admin,"member","active"]);await rpc(a,"tuki_set_member",[f.g,f.payer,"member","retired"]);
 const state=(await workspace(c,f.g)).pair_states[0];expect(state).toMatchObject({state:"unverifiable",remaining_minor:null,scope:"unverifiable"});
 expect((await workspace(a,f.g)).pair_states[0]).toMatchObject({state:"partial",remaining_minor:"50000"});
});
it("keeps exact inverse compensation and scoped state without exposing private expense details",async()=>{
 const f=await fixture();await spend(f.g,f.payer,f.receiver);expect((await workspace(a,f.g)).pair_states[0]).toMatchObject({state:"settled",remaining_minor:"0"});
 const other=await rpc(a,"tuki_create_group",["Juana","","permanent"]);await join(other,b);await join(other,c);const shared=await workspace(c,other);expect(shared.pair_states[0]).toMatchObject({state:"settled",remaining_minor:"0",scope:"global"});
 expect(JSON.stringify(shared.pair_states)).not.toContain("Private expense");
});
it("a retired party keeps its own historical ledger and archived groups do not erase remaining amounts",async()=>{
 const f=await fixture(),id=await pay(a,{...payload(f.payer,f.receiver),received:true});await ack(a,id);await rpc(a,"tuki_set_member",[f.g,f.payer,"member","retired"]);await rpc(a,"tuki_archive_group",[f.g,true]);
 expect((await workspace(b,f.g)).pair_states[0]).toMatchObject({state:"partial",remaining_minor:"50000",scope:"global"});
});
it("keeps the conservative expense edit lock and returns an authorized recovery explanation",async()=>{
 const f=await fixture(),id=await pay(a,{...payload(f.payer,f.receiver),received:true});const detail=await rpc<{can_edit:boolean;payment_locked:boolean;payment_lock_resolution:string}>(a,"tuki_expense_detail",[f.e]);
 expect(detail.can_edit).toBe(false);expect(detail.payment_locked).toBe(true);expect(detail.payment_lock_resolution).toContain("Sus autorizados deben anularlos");expect(detail.payment_lock_resolution).not.toContain(id);
});
