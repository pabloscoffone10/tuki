// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll,afterAll,it,expect } from "vitest";
let db:PGlite;const existing=randomUUID();
beforeAll(async()=>{
 db=new PGlite();await db.exec(`create role authenticated;create role anon;create schema auth;
 create table auth.users(id uuid primary key,email_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema auth to authenticated,anon;grant execute on function auth.uid() to authenticated,anon;`);
 await db.query("insert into auth.users(id,email_confirmed_at) values($1,now())",[existing]);
 await db.exec(readFileSync("supabase/migrations/202611020001_account_profiles.sql","utf8"));
 await db.exec(readFileSync("supabase/migrations/202611040003_payment_onboarding.sql","utf8"));
},30000);
afterAll(async()=>{await db?.close();});
async function rpc(user:string,name:string){return db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);return (await tx.query<{value:boolean}>(`select public.${name}() value`)).rows[0].value;});}
async function state(user:string){return(await db.query<{state:string}>("select payment_onboarding_state state from profiles where user_id=$1",[user])).rows[0].state;}
it("does not interrupt accounts created before activation",async()=>{expect(await state(existing)).toBe("done");expect(await rpc(existing,"tuki_offer_payment_onboarding")).toBe(false);});
it("offers new verified users only once, persists skip or continue, and protects other profiles",async()=>{
 const a=randomUUID(),b=randomUUID();await db.query("insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())",[a,b]);expect(await state(a)).toBe("pending");expect(await rpc(a,"tuki_offer_payment_onboarding")).toBe(true);expect(await state(a)).toBe("offered");expect(await rpc(a,"tuki_offer_payment_onboarding")).toBe(false);await rpc(a,"tuki_finish_payment_onboarding");expect(await state(a)).toBe("done");expect(await state(b)).toBe("pending");expect(await rpc(a,"tuki_offer_payment_onboarding")).toBe(false);
 await expect(db.transaction(async tx=>{await tx.exec("set local role authenticated");await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[a]);await tx.query("update profiles set payment_onboarding_state='pending' where user_id=$1",[b]);})).rejects.toThrow("permission denied");
});
it("does not offer onboarding before email verification and denies anonymous writes",async()=>{
 const id=randomUUID();await db.query("insert into auth.users(id) values($1)",[id]);expect(await rpc(id,"tuki_offer_payment_onboarding")).toBe(false);expect(await state(id)).toBe("pending");await db.query("update auth.users set email_confirmed_at=now() where id=$1",[id]);expect(await rpc(id,"tuki_offer_payment_onboarding")).toBe(true);
 await expect(db.transaction(async tx=>{await tx.exec("set local role anon");await tx.exec("select public.tuki_finish_payment_onboarding()");})).rejects.toThrow("permission denied");
});
