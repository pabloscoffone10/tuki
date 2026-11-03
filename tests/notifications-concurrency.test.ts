// @vitest-environment node
// Opt-in disposable LOCAL PostgreSQL only. Never loads .env.local or Supabase.
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
const connectionString=process.env.TUKI_NOTIFICATIONS_TEST_DATABASE_URL;
const user="90000000-0000-4000-8000-000000000001",payerUser="90000000-0000-4000-8000-000000000002";
let owner:Client,first:Client,second:Client;
async function call(client:Client,name:string,args:unknown[]=[]){return (await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
async function fixture(){const group=await call(first,"tuki_create_group",["Payments race","","permanent"]),receiver=await call(first,"tuki_ensure_person");await second.query("select set_config('request.jwt.claim.sub',$1,false)",[payerUser]);const token=randomUUID().replaceAll("-","").padEnd(64,"f");await owner.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);const hash=(await owner.query("select encode(sha256(convert_to($1,'UTF8')),'hex') hash",[token])).rows[0].hash;await call(first,"tuki_create_invitation",[group,hash,72]);await call(second,"tuki_accept_invitation",[token]);const payer=await call(second,"tuki_ensure_person"),expense=randomUUID();await call(first,"tuki_save_expense",[expense,group,0,JSON.stringify({title:"Expense",date:"2026-11-02",category:"other",currency:"UYU",amount:"500",rate:"1",payerId:receiver,method:"equal",shares:[{personId:payer,input:"1"}]})]);await second.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);return {group,receiver,payer,expense};}
async function race(a:()=>Promise<unknown>,b:()=>Promise<unknown>){
 await first.query("begin");await second.query("begin");let pending:Promise<{ok:boolean;message?:string}>|undefined;
 try{await a();const pid=(await second.query("select pg_backend_pid() pid")).rows[0].pid;pending=b().then(()=>({ok:true}),(e:Error)=>({ok:false,message:e.message}));let observed=false;
  for(let i=0;i<100;i++){if((await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock"){observed=true;break;}await new Promise(r=>setTimeout(r,10));}
  await first.query("commit");const result=await pending;expect(observed).toBe(true);return result;
 }finally{await first.query("rollback");await pending;await second.query("rollback");}
}
describe.skipIf(!connectionString)("Quick payments and reminders concurrent transactions",()=>{
 beforeAll(async()=>{
  const url=new URL(connectionString!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/tuki_phase6_test"||url.search)throw new Error("Use a pristine LOCAL tuki_phase6_test database. Remote connections forbidden.");
  owner=new Client({connectionString,connectionTimeoutMillis:3000});await owner.connect();
  if((await owner.query("select to_regclass('public.groups') existing")).rows[0].existing)throw new Error("Existing database will not be overwritten. Use a pristine database.");
  await owner.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
   do $$ begin if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;end $$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;
   create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users(id,email_confirmed_at) values('${user}',now()),('${payerUser}',now());`);
  for(const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")&&n<="202611020008_notifications_quick_payments.sql").sort())await owner.query(readFileSync(`supabase/migrations/${name}`,"utf8"));
  [first,second]=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString,connectionTimeoutMillis:3000});await c.connect();await c.query("set role authenticated;set statement_timeout='5s'");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);return c;}));
 },30000);
 afterAll(async()=>{for(const c of [first,second,owner])if(c)await c.end();});
 it("two full receiver receipts cannot overpay",async()=>{const f=await fixture();const p={payerId:f.payer,receiverId:f.receiver,amount:"500",received:true,groupId:null,date:"2026-11-02",method:"cash",note:"",reference:"",selected:[]};const result=await race(()=>call(first,"tuki_create_payment",[randomUUID(),JSON.stringify(p),true]),()=>call(second,"tuki_create_payment",[randomUUID(),JSON.stringify(p),true]));expect(result.message).toContain("payment_over_amount");});
 it("same fast payment request creates one payment and allocation",async()=>{const f=await fixture(),id=randomUUID(),p=JSON.stringify({payerId:f.payer,receiverId:f.receiver,amount:"500",received:true,groupId:null,date:"2026-11-02",method:"cash",note:"",reference:"",selected:[]});const result=await race(()=>call(first,"tuki_create_payment",[id,p,true]),()=>call(second,"tuki_create_payment",[id,p,true]));expect(result.ok).toBe(true);expect((await owner.query("select count(*)::int n from payment_allocations where payment_id=$1",[id])).rows[0].n).toBe(1);});
 it("simultaneous reminders obey the 24-hour cooldown",async()=>{const f=await fixture();const result=await race(()=>call(first,"tuki_remind_debt",[f.payer]),()=>call(second,"tuki_remind_debt",[f.payer]));expect(result.message).toContain("reminder_rate_limit");});
});
