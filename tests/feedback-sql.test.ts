// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, afterAll, it, expect } from "vitest";
let db: PGlite;
beforeAll(async () => {
 db = new PGlite();
 await db.exec("create role anon; create role authenticated; create role service_role; create schema auth; create schema tuki_private; create table auth.users(id uuid primary key);");
 await db.exec(readFileSync("supabase/migrations/202611040005_feedback.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
const submit = (bucket: string) => db.query<{id:string}>("select public.tuki_submit_feedback(null,'error','Descripción','', $1) id", [bucket]);
it("denies clients reports, sender quotas and privileged RPCs", async () => {
 for (const role of ["anon", "authenticated"]) {
  for (const sql of ["select * from tuki_private.feedback_reports", "select public.tuki_submit_feedback(null,'error','test','','x')", "select public.tuki_claim_feedback(null)", "select public.tuki_finish_feedback(gen_random_uuid(),gen_random_uuid(),null)"]) {
   await expect(db.transaction(async tx => { await tx.exec(`set local role ${role}`); await tx.exec(sql); })).rejects.toThrow(/permission denied/);
  }
 }
});
it("enforces a persistent quota and database length validation", async () => {
 for (let i=0;i<5;i++) await submit("limited");
 await expect(submit("limited")).rejects.toThrow("feedback_rate_limit");
 await expect(db.query("select public.tuki_submit_feedback(null,'error',$1,'','other')", ["x".repeat(4001)])).rejects.toThrow();
});
it("leases once, retains failures, retries and acknowledges only the active lease", async () => {
 const id = (await submit("delivery")).rows[0].id;
 const first = (await db.query<{lease:string}>("select * from public.tuki_claim_feedback($1)", [id])).rows[0];
 expect((await db.query("select * from public.tuki_claim_feedback($1)", [id])).rows).toHaveLength(0);
 await db.query("select public.tuki_finish_feedback($1,$2,'email_http_500')", [id,first.lease]);
 expect((await db.query("select last_error from tuki_private.feedback_reports where id=$1",[id])).rows[0]).toEqual({last_error:"email_http_500"});
 await db.query("update tuki_private.feedback_reports set next_attempt_at=now() where id=$1",[id]);
 const next = (await db.query<{lease:string}>("select * from public.tuki_claim_feedback($1)",[id])).rows[0];
 await db.query("select public.tuki_finish_feedback($1,$2,null)",[id,first.lease]);
 expect((await db.query("select sent_at from tuki_private.feedback_reports where id=$1",[id])).rows[0]).toEqual({sent_at:null});
 await db.query("select public.tuki_finish_feedback($1,$2,null)",[id,next.lease]);
 expect((await db.query("select * from public.tuki_claim_feedback($1)",[id])).rows).toHaveLength(0);
});
