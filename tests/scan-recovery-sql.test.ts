// @vitest-environment node
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,beforeEach,it,expect } from "vitest";
let db:PGlite,a:string,b:string;
type Job={id:string;status:string;lease?:string;acquired?:boolean;cooldown?:boolean;extraction?:unknown};
const extraction={currency:"UYU",total:"100.00",items:[],adjustments:[],warnings:[],complete:true};
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const file of readdirSync("supabase/migrations").filter(f=>f.endsWith(".sql")&&f<="202611020011_scan_recovery.sql").sort())await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
},60000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{a=randomUUID();b=randomUUID();await db.query("insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",[a,b]);});
async function rpc<T=string>(user:string,name:string,args:unknown[]=[]){return db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return(await tx.query<{v:T}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;});}
const group=()=>rpc(a,"tuki_create_group",["Private scans","","permanent"]);
const begin=(g:string,hash="a".repeat(64),retry=false,enabled=true,user=a)=>rpc<Job>(user,"tuki_begin_scan",[g,hash,enabled,retry]);
const finish=(j:Job,result:unknown=extraction,failure:string|null=null,user=a)=>rpc(user,"tuki_finish_scan",[j.id,j.lease,result===null?null:JSON.stringify(result),failure]);
async function member(g:string){const token=randomUUID().replaceAll("-","").padEnd(64,"e");await rpc(a,"tuki_create_invitation",[g,createHash("sha256").update(token).digest("hex"),72]);await rpc(b,"tuki_accept_invitation",[token]);return rpc(b,"tuki_ensure_person");}
it("persists a completed result and recovers it without a new quota reservation or provider",async()=>{
 const g=await group(),job=await begin(g);expect(job).toMatchObject({status:"processing",acquired:true});await finish(job);await finish(job);
 expect(await begin(g,"a".repeat(64),false,false)).toMatchObject({id:job.id,status:"completed",extraction});
 expect((await db.query<{n:number}>("select count(*)::int n from receipt_scan_requests where user_id=$1",[a])).rows[0].n).toBe(1);
});
it("permits a bounded retry of a failed scan after cooldown instead of blocking 24 hours",async()=>{
 const g=await group(),one=await begin(g);await finish(one,null,"provider_failed");expect(await begin(g)).toMatchObject({status:"failed",cooldown:true});
 await db.query("update tuki_private.scan_jobs set retry_after=now()-interval '1 second' where id=$1",[one.id]);const two=await begin(g);expect(two.acquired).toBe(true);expect(two.id).toBe(one.id);expect(two.lease).not.toBe(one.lease);await finish(two);expect((await begin(g)).status).toBe("completed");
});
it("never automatically restarts an ambiguous or expired lease; old workers cannot overwrite a new attempt",async()=>{
 const g=await group(),one=await begin(g);expect(await begin(g)).toMatchObject({status:"processing"});expect((await begin(g)).acquired).toBeUndefined();
 await db.query("update tuki_private.scan_jobs set lease_until=now()-interval '1 second' where id=$1",[one.id]);expect((await begin(g)).status).toBe("recoverable");
 const two=await begin(g,"a".repeat(64),true);expect(two.acquired).toBe(true);await expect(finish(one)).rejects.toThrow("scan_conflict");await finish(two);
});
it("records transport outcome unknown and requires extra retry consent",async()=>{
 const g=await group(),one=await begin(g);await finish(one,null,"outcome_unknown");expect((await begin(g)).status).toBe("recoverable");
 await db.query("update tuki_private.scan_jobs set retry_after=now()-interval '1 second' where id=$1",[one.id]);expect((await begin(g)).acquired).toBeUndefined();expect((await begin(g,"a".repeat(64),true)).acquired).toBe(true);
});
it("isolates results even between members of the same group and rejects access after retirement",async()=>{
 const g=await group(),one=await begin(g);await finish(one);await expect(begin(g,"a".repeat(64),false,true,b)).rejects.toThrow("group_forbidden");const person=await member(g);
 const other=await begin(g,"a".repeat(64),false,true,b);expect(other.id).not.toBe(one.id);expect(other.extraction).toBeUndefined();await expect(finish(one,extraction,null,b)).rejects.toThrow("scan_forbidden");
 await rpc(a,"tuki_set_member",[g,person,"member","retired"]);await expect(begin(g,"a".repeat(64),false,true,b)).rejects.toThrow("group_forbidden");await expect(finish(other,extraction,null,b)).rejects.toThrow("scan_forbidden");
});
it("retains per-user minute/day limits on every actual provider attempt, including retries",async()=>{
 const g=await group(),one=await begin(g);await finish(one,null,"provider_failed");await db.query("update tuki_private.scan_jobs set retry_after=now()-interval '1 second' where id=$1",[one.id]);await begin(g);await expect(begin(g,"b".repeat(64))).rejects.toThrow("scan_limit");
 await db.query("update receipt_scan_requests set created_at=now()-interval '2 minutes' where user_id=$1",[a]);await db.query("insert into receipt_scan_requests(user_id,hash,created_at) select $1,repeat('d',64),now()-interval '2 minutes' from generate_series(1,8)",[a]);await expect(begin(g,"c".repeat(64))).rejects.toThrow("scan_limit");
});
it("does not expose the cache, original opaque reservation or cleanup to browser roles",async()=>{
 const grants=await db.query<{table_read:boolean;reserve:boolean;purge:boolean;begin:boolean}>(`select has_table_privilege('authenticated','tuki_private.scan_jobs','select') table_read,has_function_privilege('authenticated','public.tuki_reserve_scan(uuid,text)','execute') reserve,has_function_privilege('authenticated','public.tuki_purge_expired_scans()','execute') purge,has_function_privilege('anon','public.tuki_begin_scan(uuid,text,boolean,boolean)','execute') begin`);expect(grants.rows[0]).toEqual({table_read:false,reserve:false,purge:false,begin:false});
});
it("bounds stored results, expires recoverability, and allows only operator cleanup",async()=>{
 const g=await group(),job=await begin(g);await expect(finish(job,{...extraction,items:new Array(81).fill({})})).rejects.toThrow("invalid_extraction");await finish(job);
 await db.query("update tuki_private.scan_jobs set expires_at=now()-interval '1 second' where id=$1",[job.id]);expect(await begin(g,"a".repeat(64),false,false)).toEqual({status:"pending"});
 expect((await db.query<{n:number}>("select public.tuki_purge_expired_scans() n")).rows[0].n).toBeGreaterThanOrEqual(1);
});
it("does not block safe deletion of an empty group just because its scan cache exists",async()=>{
 const g=await group();await begin(g);await rpc(a,"tuki_delete_group",[g,true]);expect((await db.query("select id from tuki_private.scan_jobs where group_id=$1",[g])).rows).toHaveLength(0);
});
