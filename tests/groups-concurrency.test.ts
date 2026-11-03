// @vitest-environment node
// Opt-in only. NEVER uses .env.local or a Supabase URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const connectionString = process.env.TUKI_TEST_DATABASE_URL;
const aId = "10000000-0000-4000-8000-000000000001";
const bId = "10000000-0000-4000-8000-000000000002";
const cId = "10000000-0000-4000-8000-000000000003";
let owner: Client; let a: Client; let b: Client; let c: Client;
async function call(client: Client, name: string, args: unknown[]) {
  return (await client.query(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(",")}) as result`, args)).rows[0].result as string;
}
async function invitation(group: string) {
  const token = randomBytes(32).toString("hex");
  await call(a, "tuki_create_invitation", [group, createHash("sha256").update(token).digest("hex"), 72]);
  return token;
}
async function race(first: Client, firstCall: () => Promise<unknown>, second: Client, secondCall: () => Promise<unknown>) {
  const pid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
  let pending: Promise<{ ok: boolean; message?: string }> | undefined;
  let observedLock = false;
  await first.query("begin"); await second.query("begin");
  try {
    await firstCall();
    pending = secondCall().then(() => ({ ok: true }), (error: Error) => ({ ok: false, message: error.message }));
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await owner.query("select wait_event_type from pg_stat_activity where pid=$1", [pid]);
      if (state.rows[0]?.wait_event_type === "Lock") { observedLock = true; break; }
      await new Promise((done) => setTimeout(done, 10));
    }
    await first.query("commit");
    const outcome = await pending;
    expect(observedLock).toBe(true);
    return outcome;
  } finally {
    await first.query("rollback");
    await pending;
    await second.query("rollback");
  }
}

describe.skipIf(!connectionString)("PostgreSQL local: dos conexiones reales", () => {
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.pathname !== "/tuki_phase3_test" || url.search) {
      throw new Error("Concurrency tests require a pristine local database named tuki_phase3_test. Remote connections are forbidden.");
    }
    // No database dropping/resetting. Require a fresh disposable database.
    owner = new Client({ connectionString, connectionTimeoutMillis: 3000 }); await owner.connect();
    if ((await owner.query("select to_regclass('public.groups') as existing")).rows[0].existing) throw new Error("Use a fresh tuki_phase3_test database; no existing tables will be overwritten.");
    await owner.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      end $$;
      create schema auth;
      create table auth.users(id uuid primary key, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon; grant execute on function auth.uid() to authenticated,anon;
      insert into auth.users(id,email_confirmed_at) values ('${aId}',now()),('${bId}',now()),('${cId}',now());`);
    for (const file of ["202611020001_account_profiles.sql", "202611020002_groups_persons.sql", "202611020003_replace_duplicate_guest.sql"]) await owner.query(readFileSync(resolve("supabase/migrations", file), "utf8"));
    [a, b, c] = await Promise.all([aId, bId, cId].map(async (id) => {
      const client = new Client({ connectionString, connectionTimeoutMillis: 3000 }); await client.connect();
      await client.query("set role authenticated; set statement_timeout='5s'");
      await client.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); return client;
    }));
  }, 30000);
  afterAll(async () => { for (const client of [a, b, c, owner]) if (client) await client.end(); });

  it("dos administradores no pueden demoverse simultáneamente dejando cero activos", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent admins", "", "permanent"]);
    await call(b, "tuki_accept_invitation", [await invitation(group)]);
    const aPerson = await call(a, "tuki_ensure_person", []); const bPerson = await call(b, "tuki_ensure_person", []);
    await call(a, "tuki_set_member", [group, bPerson, "admin", "active"]);
    const outcome = await race(a, () => call(a, "tuki_set_member", [group, aPerson, "member", "active"]), b, () => call(b, "tuki_set_member", [group, bPerson, "member", "active"]));
    expect(outcome.message).toContain("last_admin");
    expect((await owner.query("select count(*)::int as n from group_members where group_id=$1 and role='admin' and status='active'", [group])).rows[0].n).toBe(1);
  });
  it("dos destinatarios no pueden consumir la misma invitación", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent invitation", "", "permanent"]);
    const token = await invitation(group);
    const outcome = await race(b, () => call(b, "tuki_accept_invitation", [token]), c, () => call(c, "tuki_accept_invitation", [token]));
    expect(outcome.message).toContain("invitation_used");
    expect((await owner.query("select count(*)::int as n from group_members where group_id=$1", [group])).rows[0].n).toBe(2);
  });
  it("archivar concurrentemente impide aceptar una invitación pendiente", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent archive", "", "permanent"]);
    const token = await invitation(group);
    const outcome = await race(a, () => call(a, "tuki_archive_group", [group, true]), b, () => call(b, "tuki_accept_invitation", [token]));
    expect(outcome.message).toContain("group_archived");
  });
  it("retirar concurrentemente no puede ser deshecho por un enlace genérico", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent retirement", "", "permanent"]);
    const pending = await invitation(group);
    await call(b, "tuki_accept_invitation", [await invitation(group)]);
    const bPerson = await call(b, "tuki_ensure_person", []);
    const outcome = await race(a, () => call(a, "tuki_set_member", [group, bPerson, "member", "retired"]), b, () => call(b, "tuki_accept_invitation", [pending]));
    expect(outcome.message).toContain("member_retired");
    expect((await owner.query("select status from group_members where group_id=$1 and person_id=$2", [group, bPerson])).rows[0].status).toBe("retired");
  });
  it("revocar concurrentemente bloquea el consumo que esperaba el bloqueo", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent revocation", "", "permanent"]);
    const raw = await invitation(group);
    const id = (await owner.query("select id from group_invitations where token_hash=$1", [createHash("sha256").update(raw).digest("hex")])).rows[0].id;
    const outcome = await race(a, () => call(a, "tuki_revoke_invitation", [group, id]), b, () => call(b, "tuki_accept_invitation", [raw]));
    expect(outcome.message).toContain("invitation_revoked");
  });
  it("un administrador demovido concurrentemente pierde autoridad antes de escribir", async () => {
    const group = await call(a, "tuki_create_group", ["Concurrent authority", "", "permanent"]);
    await call(b, "tuki_accept_invitation", [await invitation(group)]);
    const bPerson = await call(b, "tuki_ensure_person", []);
    await call(a, "tuki_set_member", [group, bPerson, "admin", "active"]);
    const outcome = await race(a, () => call(a, "tuki_set_member", [group, bPerson, "member", "active"]), b, () => call(b, "tuki_update_group", [group, "Must not change", "", "permanent"]));
    expect(outcome.message).toContain("group_forbidden");
    expect((await owner.query("select name from groups where id=$1", [group])).rows[0].name).toBe("Concurrent authority");
  });
  it("dos correcciones simultáneas no pueden reemplazar dos veces la misma participación", async () => {
    const group = await call(a,"tuki_create_group",["Concurrent correction","","permanent"]);
    const other = await call(a,"tuki_create_group",["Canonical people","","permanent"]);
    const source = await call(a,"tuki_add_guest",[group,"Mati",null]);
    const target = await call(a,"tuki_add_guest",[other,"Mati",null]);
    const alternate = await call(a,"tuki_add_guest",[other,"Mati distinto",null]);
    const second = new Client({ connectionString, connectionTimeoutMillis: 3000 }); await second.connect();
    try {
      await second.query("set role authenticated; set statement_timeout='5s'");
      await second.query("select set_config('request.jwt.claim.sub',$1,false)",[aId]);
      const outcome = await race(a,() => call(a,"tuki_replace_guest",[group,source,target,true]),second,() => call(second,"tuki_replace_guest",[group,source,alternate,true]));
      expect(outcome.message).toContain("correction_source_unavailable");
      expect((await owner.query("select replaced_by_person_id from group_members where group_id=$1 and person_id=$2",[group,source])).rows[0].replaced_by_person_id).toBe(target);
      expect((await owner.query("select id from group_events where group_id=$1 and event_type='guest_replaced'",[group])).rows).toHaveLength(1);
    } finally { await second.end(); }
  });
});
