// @vitest-environment node
// Opt-in disposable LOCAL PostgreSQL only. Never loads .env.local or Supabase.
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { beforeAll,afterAll,describe,it,expect } from "vitest";
const connectionString=process.env.TUKI_FINANCE_TEST_DATABASE_URL;
const user="90000000-0000-4000-8000-000000000001";
let owner:Client,first:Client,second:Client;
async function call(client:Client,name:string,args:unknown[]=[]){return (await client.query(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
async function fixture(){const group=await call(first,"tuki_create_group",["Concurrency","","permanent"]);const payer=await call(first,"tuki_ensure_person");const guest=await call(first,"tuki_add_guest",[group,"Guest",null]);return {group,payer,guest};}
function payload(payer:string,guest:string){return JSON.stringify({title:"Cena",date:"2026-11-02",category:"food",currency:"UYU",amount:"100",payerId:payer,method:"equal",shares:[{personId:guest,input:"1"}]});}
async function race(a:()=>Promise<unknown>,b:()=>Promise<unknown>){
 await first.query("begin");await second.query("begin");let pending:Promise<{ok:boolean;message?:string}>|undefined;
 try{await a();const pid=(await second.query("select pg_backend_pid() pid")).rows[0].pid;pending=b().then(()=>({ok:true}),(e:Error)=>({ok:false,message:e.message}));let observed=false;
  for(let i=0;i<100;i++){if((await owner.query("select wait_event_type from pg_stat_activity where pid=$1",[pid])).rows[0]?.wait_event_type==="Lock"){observed=true;break;}await new Promise(r=>setTimeout(r,10));}
  await first.query("commit");const result=await pending;expect(observed).toBe(true);return result;
 }finally{await first.query("rollback");await pending;await second.query("rollback");}
}
describe.skipIf(!connectionString)("Phase 4 real concurrent transactions",()=>{
 beforeAll(async()=>{
  const url=new URL(connectionString!);if(!["localhost","127.0.0.1","[::1]"].includes(url.hostname)||url.pathname!=="/tuki_phase4_test"||url.search)throw new Error("Use a pristine LOCAL tuki_phase4_test database. Remote connections forbidden.");
  owner=new Client({connectionString,connectionTimeoutMillis:3000});await owner.connect();
  if((await owner.query("select to_regclass('public.groups') existing")).rows[0].existing)throw new Error("Existing database will not be overwritten. Use a pristine database.");
  await owner.query(`do $$ begin if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if; if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if; end $$;
   create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;insert into auth.users(id,email_confirmed_at) values('${user}',now());`);
  for(const name of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")&&n<="202611020005_safe_removal.sql").sort())await owner.query(readFileSync(`supabase/migrations/${name}`,"utf8"));
  [first,second]=await Promise.all([0,1].map(async()=>{const c=new Client({connectionString,connectionTimeoutMillis:3000});await c.connect();await c.query("set role authenticated;set statement_timeout='5s'");await c.query("select set_config('request.jwt.claim.sub',$1,false)",[user]);return c;}));
 },30000);
 afterAll(async()=>{for(const c of [first,second,owner])if(c)await c.end();});
 it("expense first blocks physical group deletion",async()=>{const {group,payer,guest}=await fixture();const result=await race(()=>call(first,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]),()=>call(second,"tuki_delete_group",[group,true]));expect(result.message).toContain("group_has_financial_history");});
 it("group deletion first blocks new expense",async()=>{const {group,payer,guest}=await fixture();const result=await race(()=>call(first,"tuki_delete_group",[group,true]),()=>call(second,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]));expect(result.message).toContain("group_forbidden");});
 it("expense first forces member retirement instead of deletion",async()=>{const {group,payer,guest}=await fixture();let mode:unknown;const result=await race(()=>call(first,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]),async()=>{mode=await call(second,"tuki_remove_member",[group,guest,true]);});expect(result.ok).toBe(true);expect(mode).toBe("retired");});
 it("member deletion first excludes that identity from new expenses",async()=>{const {group,payer,guest}=await fixture();const result=await race(()=>call(first,"tuki_remove_member",[group,guest,true]),()=>call(second,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]));expect(result.message).toContain("invalid_participant");});
 it("two edits cannot replace the same version",async()=>{const {group,payer,guest}=await fixture(),id=randomUUID(),p=payload(payer,guest);await call(first,"tuki_save_expense",[id,group,0,p]);const result=await race(()=>call(first,"tuki_save_expense",[id,group,1,p]),()=>call(second,"tuki_save_expense",[id,group,1,p]));expect(result.message).toContain("expense_conflict");});
 it("archiving first blocks expense creation",async()=>{const {group,payer,guest}=await fixture();const result=await race(()=>call(first,"tuki_archive_group",[group,true]),()=>call(second,"tuki_save_expense",[randomUUID(),group,0,payload(payer,guest)]));expect(result.message).toContain("group_archived");});
 it("concurrent retries create a single obligation",async()=>{const {group,payer,guest}=await fixture(),id=randomUUID(),p=payload(payer,guest);const result=await race(()=>call(first,"tuki_save_expense",[id,group,0,p]),()=>call(second,"tuki_save_expense",[id,group,0,p]));expect(result.ok).toBe(true);expect((await owner.query("select count(*)::int n from obligations where expense_id=$1",[id])).rows[0].n).toBe(1);});
});
