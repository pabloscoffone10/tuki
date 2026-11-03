// @vitest-environment node
import { readFileSync,readdirSync } from "node:fs";
import { randomUUID,createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,it,expect } from "vitest";
let db:PGlite;const a=randomUUID(),b=randomUUID(),c=randomUUID();
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema storage;create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,storage to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));alter table storage.objects enable row level security;grant select,insert,delete on storage.objects to authenticated;`);
 for(const file of readdirSync("supabase/migrations").filter(n=>n.endsWith(".sql")).sort())await db.exec(readFileSync(`supabase/migrations/${file}`,"utf8"));
 await db.query("insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now()),($3,now())",[a,b,c]);
},60000);
afterAll(async()=>{await db?.close();});
async function query<T=Record<string,unknown>>(user:string,sql:string,args:unknown[]=[]){return db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return tx.query<T>(sql,args);});}
async function rpc<T=string>(user:string,name:string,args:unknown[]=[]){return(await query<{v:T}>(user,`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(",")}) v`,args)).rows[0].v;}
async function join(g:string,user:string){const token=randomUUID().replaceAll("-","").padEnd(64,"a");await rpc(a,"tuki_create_invitation",[g,createHash("sha256").update(token).digest("hex"),72]);await rpc(user,"tuki_accept_invitation",[token]);return rpc(user,"tuki_ensure_person");}
it("no application SECURITY DEFINER has an unsafe search_path",async()=>{const result=await db.query("select n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','tuki_private') and p.prosecdef and not coalesce(p.proconfig @> array['search_path=\"\"'],false)");expect(result.rows).toEqual([]);});
it("anonymous users cannot execute application RPCs",async()=>{const result=await db.query("select p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','tuki_private') and has_function_privilege('anon',p.oid,'execute')");expect(result.rows).toEqual([]);});
it("tables use RLS and authenticated users have no direct domain writes",async()=>{
 const result=await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p') and(not c.relrowsecurity or has_table_privilege('authenticated',c.oid,'insert') or has_table_privilege('authenticated',c.oid,'update') or has_table_privilege('authenticated',c.oid,'delete'))");expect(result.rows).toEqual([]);
 const privateTables=await db.query("select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='tuki_private' and c.relkind in('r','p','v') and(has_table_privilege('authenticated',c.oid,'select') or has_table_privilege('authenticated',c.oid,'insert') or has_table_privilege('authenticated',c.oid,'update') or has_table_privilege('authenticated',c.oid,'delete'))");expect(privateTables.rows).toEqual([]);
});
it("private executable helpers are restricted to read-only policy predicates",async()=>{const result=await db.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='tuki_private' and has_function_privilege('authenticated',p.oid,'execute') and proname not in('current_person','is_member','is_admin','can_view_person','can_view_payment','ticket_access')");expect(result.rows).toEqual([]);});
it("storage policies allow own reservation but deny foreign read, write and metadata theft",async()=>{
 const g=await rpc(a,"tuki_create_group",["Private origin","","permanent"]),id=randomUUID(),path=await rpc(a,"tuki_reserve_ticket",[id,g,"image/png",20]);
 await query(a,"insert into storage.objects(bucket_id,name) values('tuki-tickets',$1)",[path]);expect((await query(a,"select name from storage.objects where name=$1",[path])).rows).toHaveLength(1);expect((await query(c,"select name from storage.objects where name=$1",[path])).rows).toHaveLength(0);
 await expect(query(c,"insert into storage.objects(bucket_id,name) values('tuki-tickets',$1)",[`${g}/${randomUUID()}`])).rejects.toThrow();
 await expect(rpc(c,"tuki_reserve_ticket",[id,g,"image/png",20])).rejects.toThrow("group_forbidden");await expect(query(c,"select * from ticket_uploads")).rejects.toThrow("permission denied");
});
it("retired administrators lose authority while memberships remain",async()=>{
 const g=await rpc(a,"tuki_create_group",["Retirement","","permanent"]),p=await join(g,b);await rpc(a,"tuki_set_member",[g,p,"admin","active"]);await rpc(a,"tuki_set_member",[g,p,"admin","retired"]);await expect(rpc(b,"tuki_update_group",[g,"Forbidden","","permanent"])).rejects.toThrow("group_forbidden");expect((await query(b,"select id from groups where id=$1",[g])).rows).toEqual([]);expect((await query(a,"select status from group_members where group_id=$1 and person_id=$2",[g,p])).rows[0].status).toBe("retired");
});
it("same-name guests are separate identities and cannot be claimed by table writes",async()=>{
 const g=await rpc(a,"tuki_create_group",["No claims","","permanent"]),one=await rpc(a,"tuki_add_guest",[g,"Mati",null]),two=await rpc(a,"tuki_add_guest",[g,"Mati",null]);expect(one).not.toBe(two);await expect(query(a,"update persons set user_id=$1 where id=$2",[a,one])).rejects.toThrow();await expect(query(c,"update persons set user_id=$1 where id=$2",[c,one])).rejects.toThrow();
});
