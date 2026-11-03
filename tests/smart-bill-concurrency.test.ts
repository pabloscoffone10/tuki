// @vitest-environment node
// Opt-in disposable LOCAL PostgreSQL only. Never loads .env.local or Supabase.
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
const connectionString=process.env.TUKI_SMART_TEST_DATABASE_URL;
const user="90000000-0000-4000-8000-000000000001";
let owner:Client,first:Client,second:Client;
async function call(client:Client,name:string,args:unknown[]=[]){return (await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
async function fixture(){const group=await call(first,"tuki_create_group",["Concurrency","","permanent"]);const payer=await call(first,"tuki_ensure_person");const guest=await call(first,"tuki_add_guest",[group,"Guest",null]);return {group,payer,guest};}
function payload(payer:string,guest:string){return JSON.stringify({title:"Smart bill",date:"2026-11-02",category:"food",payerId:payer,smartBill:{currency:"UYU",rate:"1",items:[{id:randomUUID(),name:"Cena",quantity:"1",priceMode:"subtotal",price:"100",discount:"0",split:"equal",consumers:[{personId:guest,input:"1"}],reviewed:true}],adjustments:[],ticketTotal:"100",noTotalReason:"",confirmed:true,uploadId:null}});}
async function race(a:()=>Promise<unknown>,b:()=>Promise<unknown>){
 await first.query("begin");await second.query("begin");let pending:Promise<{ok:boolean;message?:string}>|undefined;
 try{await a();const pid=(await second.query("select pg_backend_pid() pid")).rows[0].pid;pending=b().then(()=>({ok:true}),(e:Error)=>({ok:false,message:e.message}));let observed=false;
  for(let i=0;i<100;i++){if((await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock"){observed=true;break;}await new Promise(r=>setTimeout(r,10));}
  await first.query("commit");const result=await pending;expect(observed).toBe(true);return result;
 }finally{await first.query("rollback");await pending;await second.query("rollback");}
}
describe.skipIf(!connectionString)("Smart bills real concurrent transactions",()=>{
 beforeAll(async()=>{
  const url=new URL(connectionString!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/tuki_phase45_test"||url.search)throw new Error("Use a pristine LOCAL tuki_phase45_test database. Remote connections forbidden.");
  owner=new Client({connectionString,connectionTimeoutMillis:3000});await owner.connect();
  if((await owner.query("select to_regclass('public.groups') existing")).rows[0].existing)throw new Error("Existing database will not be overwritten. Use a pristine database.");
  await owner.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
   create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert,delete on storage.objects to authenticated;
   create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users(id,email_confirmed_at) values('${user}',now());`);
  for(const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")&&n<="202611020006_smart_bills.sql").sort())await owner.query(readFileSync(`supabase/migrations/${name}`,"utf8"));
  [first,second]=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString,connectionTimeoutMillis:3000});await c.connect();await c.query("set role authenticated;set statement_timeout='5s'");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);return c;}));
 },30000);
 afterAll(async()=>{for(const c of [first,second,owner])if(c)await c.end();});
 it("two smart edits cannot overwrite one version or split document from expense",async()=>{const {group,payer,guest}=await fixture(),id=randomUUID(),p=payload(payer,guest);await call(first,"tuki_save_expense",[id,group,0,p]);const result=await race(()=>call(first,"tuki_save_expense",[id,group,1,p]),()=>call(second,"tuki_save_expense",[id,group,1,p]));expect(result.message).toContain("expense_conflict");expect((await owner.query("select count(*)::int n from smart_bill_revisions s join expense_revisions r on r.id=s.revision_id where r.expense_id=$1",[id])).rows[0].n).toBe(2);});
 it("voiding first prevents a concurrent smart edit",async()=>{const {group,payer,guest}=await fixture(),id=randomUUID(),p=payload(payer,guest);await call(first,"tuki_save_expense",[id,group,0,p]);const result=await race(()=>call(first,"tuki_void_expense",[id,1,true]),()=>call(second,"tuki_save_expense",[id,group,1,p]));expect(result.message).toContain("expense_conflict");});
 it("smart creation first prevents physical group deletion",async()=>{const {group,payer,guest}=await fixture();const result=await race(()=>call(first,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]),()=>call(second,"tuki_delete_group",[group,true]));expect(result.message).toContain("group_has_financial_history");});
 it("binding a receipt prevents a pending Storage deletion race",async()=>{const {group,payer,guest}=await fixture(),id=randomUUID(),upload=randomUUID();const path=await call(first,"tuki_reserve_ticket",[upload,group,"image/png",50]);await first.query("insert into storage.objects(bucket_id,name) values('tuki-tickets',$1)",[path]);const data=JSON.parse(payload(payer,guest));data.smartBill.uploadId=upload;const result=await race(()=>call(first,"tuki_save_expense",[id,group,0,JSON.stringify(data)]),()=>second.query("delete from storage.objects where name=$1",[path]));if(!result.ok)expect(result.message).toContain("foreign key");expect((await owner.query("select count(*)::int n from storage.objects where name=$1",[path])).rows[0].n).toBe(1);});
});
