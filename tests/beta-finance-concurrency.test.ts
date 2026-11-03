// @vitest-environment node
// Real PostgreSQL only. The runner creates an isolated database, never Supabase.
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { Client } from "pg";
import { beforeAll,afterAll,beforeEach,afterEach,describe,it,expect } from "vitest";
const connectionString=process.env.TUKI_BETA_TEST_DATABASE_URL;
const adminA=randomUUID(),adminB=randomUUID();
let owner:Client,first:Client,second:Client;
async function call<T=string>(c:Client,name:string,args:unknown[]=[]):Promise<T>{return(await c.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
async function identity(c:Client,user:string){await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);}
async function clearOperation(c:Client){const op=await call<{id:string;state:string}|null>(c,"tuki_current_payment_operation");if(op)await call(c,op.state==="prepared"?"tuki_cancel_payment_operation":"tuki_ack_payment_operation",[op.id]);}
async function addAdmin(g:string){const token=randomUUID().replaceAll("-","").padEnd(64,"f");await call(first,"tuki_create_invitation",[g,createHash("sha256").update(token).digest("hex"),72]);await call(second,"tuki_accept_invitation",[token]);const person=await call(second,"tuki_ensure_person");await call(first,"tuki_set_member",[g,person,"admin","active"]);return person;}
async function fixture(){const group=await call(first,"tuki_create_group",["Concurrency beta","","permanent"]),otherAdmin=await addAdmin(group),payer=await call(first,"tuki_add_guest",[group,"Payer",null]),receiver=await call(first,"tuki_add_guest",[group,"Receiver",null]),expense=randomUUID();await call(first,"tuki_save_expense",[expense,group,0,expenseData(payer,receiver)]);return {group,otherAdmin,payer,receiver,expense};}
function expenseData(payer:string,receiver:string){return JSON.stringify({title:"Expense",date:"2026-11-02",category:"other",currency:"UYU",amount:"800",rate:"1",payerId:receiver,method:"equal",shares:[{personId:payer,input:"1"}]});}
type Fixture=Awaited<ReturnType<typeof fixture>>;
const paymentData=(f:Fixture,amount="800",administrative=true)=>JSON.stringify({payerId:f.payer,receiverId:f.receiver,amount,groupId:f.group,administrative,administrativeReason:administrative?"Cash delivery personally verified":"",date:"2026-11-02",method:"cash",note:"",reference:"",selected:[]});
async function pay(c:Client,f:Fixture,amount="800",id=randomUUID(),administrative=true){await call(c,"tuki_create_payment",[id,paymentData(f,amount,administrative),true]);await call(c,"tuki_ack_payment_operation",[id]);return id;}
const transition=(c:Client,id:string,version:number,action="confirm",request=randomUUID())=>call(c,"tuki_transition_payment",[id,version,action,"Cash delivery personally verified",request,true]);
async function race(a:()=>Promise<unknown>,b:()=>Promise<unknown>){
 await first.query("begin");await second.query("begin");let pending:Promise<{ok:boolean;message?:string}>|undefined;
 try{
  await a();const pid=(await second.query("select pg_backend_pid() pid")).rows[0].pid;const started=performance.now();
  pending=b().then(()=>({ok:true}),(e:Error)=>({ok:false,message:e.message}));let observed=false;
  for(let i=0;i<100;i++){if((await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock"){observed=true;break;}await new Promise(resolve=>setTimeout(resolve,10));}
  await first.query("commit");const result=await pending;if(result.ok)await second.query("commit");else await second.query("rollback");const elapsed=Math.round(performance.now()-started);console.info(`Controlled lock wait + second operation: ${elapsed}ms (synthetic test, not a production benchmark)`);expect(observed).toBe(true);return result;
 }finally{await first.query("rollback");await pending;await second.query("rollback");}
}
describe.skipIf(!connectionString)("Beta financial invariants with multiple PostgreSQL connections",()=>{
 beforeAll(async()=>{
  const url=new URL(connectionString!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/tuki_beta_test"||url.search||url.hash)throw Error("Use an empty LOCAL tuki_beta_test database; remote access forbidden.");
  owner=new Client({connectionString,connectionTimeoutMillis:3000});await owner.connect();if((await owner.query("select to_regclass('public.groups') existing")).rows[0].existing)throw Error("Existing database is never overwritten.");
  await owner.query(`do $$begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end$$;
  create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
  for(const file of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort())await owner.query(readFileSync(`supabase/migrations/${file}`,"utf8"));
  await owner.query("insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",[adminA,adminB]);
  [first,second]=await Promise.all([adminA,adminB].map(async user=>{const client=new Client({connectionString,connectionTimeoutMillis:3000});await client.connect();await client.query("set role authenticated;set statement_timeout='5s'");await identity(client,user);return client;}));
 },60000);
 beforeEach(async()=>{await identity(first,adminA);await identity(second,adminB);await clearOperation(first);await clearOperation(second);});
 afterEach(async()=>{const checks=await owner.query(readFileSync("supabase/audits/financial_reconciliation.sql","utf8"));expect(checks.rows).toEqual([]);});
 afterAll(async()=>{for(const c of[first,second,owner])if(c)await c.end();});
 it("two full payments cannot consume the same debt",async()=>{const f=await fixture();const r=await race(()=>pay(first,f),()=>pay(second,f));expect(r.message).toContain("payment_over_amount");});
 it("two confirmations cannot allocate twice",async()=>{const f=await fixture(),id=await pay(first,f,"800",randomUUID(),false);const r=await race(()=>transition(first,id,1),()=>transition(second,id,1));expect(r.message).toContain("payment_conflict");});
 it("confirmation racing pending cancellation has no partial result",async()=>{const f=await fixture(),id=await pay(first,f,"800",randomUUID(),false);const r=await race(()=>transition(first,id,1),()=>transition(second,id,1,"void"));expect(r.message).toContain("payment_conflict");expect((await owner.query("select status from payments where id=$1",[id])).rows[0].status).toBe("confirmed");});
 it("partial payments cannot exceed the debt together",async()=>{const f=await fixture();const r=await race(()=>pay(first,f,"500"),()=>pay(second,f,"500"));expect(r.message).toContain("payment_over_amount");});
 it("concurrent same-key retries have one payment and allocations",async()=>{const f=await fixture(),id=randomUUID();await identity(second,adminA);const r=await race(()=>pay(first,f,"300",id),()=>pay(second,f,"300",id));expect(r.ok).toBe(true);expect((await owner.query("select count(*)::int n from payment_allocations where payment_id=$1",[id])).rows[0].n).toBe(1);});
 it("recovery waits for an in-flight financial commit before reporting its result",async()=>{const f=await fixture(),id=randomUUID();await identity(second,adminA);let recovered:{id:string;state:string;payment_status:string}|undefined;const r=await race(()=>call(first,"tuki_create_payment",[id,paymentData(f,"300"),true]),async()=>{recovered=await call(second,"tuki_current_payment_operation");});expect(r.ok).toBe(true);expect(recovered).toMatchObject({id,state:"processed",payment_status:"confirmed"});});
 it("settlement prevents concurrent editing of its expense",async()=>{const f=await fixture();const r=await race(()=>pay(first,f,"300"),()=>call(second,"tuki_save_expense",[f.expense,f.group,1,expenseData(f.payer,f.receiver)]));expect(r.message).toContain("expense_has_confirmed_payments");});
 it("role loss is rechecked after waiting on the group lock",async()=>{const f=await fixture(),id=await pay(first,f,"300",randomUUID(),false);const r=await race(()=>call(first,"tuki_set_member",[f.group,f.otherAdmin,"member","active"]),()=>transition(second,id,1));expect(r.ok).toBe(false);expect(r.message).toMatch(/payment_(receiver_required|forbidden)/);});
 it("member removal during payment preserves financial membership history",async()=>{const f=await fixture();let mode;const r=await race(()=>pay(first,f,"300"),async()=>{mode=await call(second,"tuki_remove_member",[f.group,f.payer,true]);});expect(r.ok).toBe(true);expect(mode).toBe("retired");});
 it("different origin groups with shared identities remain separately allocated",async()=>{const f=await fixture(),other=await call(first,"tuki_create_group",["Other origin","","permanent"]);await addAdmin(other);for(const person of[f.payer,f.receiver])await call(first,"tuki_add_guest",[other,null,person]);await call(first,"tuki_save_expense",[randomUUID(),other,0,expenseData(f.payer,f.receiver)]);let verified=false;const r=await race(()=>pay(first,f),async()=>{const id=await pay(second,{...f,group:other});verified=(await second.query("select bool_and(o.group_id=$2) valid from payment_allocations a join obligations o on o.id=a.obligation_id where a.payment_id=$1",[id,other])).rows[0].valid;});expect(r.ok).toBe(true);expect(verified).toBe(true);});
 it("a reversal serializes before a replacement payment",async()=>{const f=await fixture(),id=await pay(first,f);let verified=false;const r=await race(()=>transition(first,id,2,"void"),async()=>{const next=await pay(second,f);verified=(await second.query("select status from payments where id=$1",[next])).rows[0].status==="confirmed";});expect(r.ok).toBe(true);expect(verified).toBe(true);});
});
