// @vitest-environment node
// Real embedded PostgreSQL: roles, policies, privileges, triggers and RPCs.
// PGlite serializes one connection; multi-connection locking is tested separately.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let db: PGlite;
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const c = "00000000-0000-4000-8000-000000000003";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
let counter = 0;
const token = () => (++counter).toString(16).padStart(64, "0");

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create table auth.users(id uuid primary key, email_confirmed_at timestamptz, raw_user_meta_data jsonb not null default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated, anon; grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values ('${a}',now(),'{"display_name":"Ana"}'),('${b}',now(),'{"display_name":"Beto"}'),('${c}',now(),'{"display_name":"Cami"}');`);
  for (const file of ["202611020001_account_profiles.sql", "202611020002_groups_persons.sql", "202611020003_replace_duplicate_guest.sql"]) {
    await db.exec(readFileSync(resolve("supabase/migrations", file), "utf8"));
  }
}, 60000);
afterAll(async () => { await db?.close(); });

async function queryAs<T>(user: string, sql: string, values: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
    return tx.query<T>(sql, values);
  });
}
async function rpc<T = string>(user: string, name: string, values: unknown[] = []) {
  const result = await queryAs<{ result: T }>(user, `select public.${name}(${values.map((_, index) => `$${index + 1}`).join(",")}) as result`, values);
  return result.rows[0].result;
}
const create = (user = a) => rpc(user, "tuki_create_group", ["Un grupo real de prueba", "Descripción", "permanent"]);
const person = (user: string) => rpc(user, "tuki_ensure_person");
async function invite(group: string, owner = a, hours = 72) {
  const raw = token();
  const id = await rpc(owner, "tuki_create_invitation", [group, hash(raw), hours]);
  return { raw, id };
}

describe("identidad global y RLS SQL", () => {
  it("rechaza una primera aplicación sin la base de perfiles, antes de crear objetos", async () => {
    const isolated = new PGlite();
    try {
      await expect(isolated.exec(readFileSync(resolve("supabase/migrations/202611020002_groups_persons.sql"), "utf8"))).rejects.toThrow("phase2_profiles_required");
      await isolated.exec("rollback");
      expect((await isolated.query<{ present: boolean }>("select exists(select 1 from pg_namespace where nspname='tuki_private') as present")).rows[0].present).toBe(false);
    } finally { await isolated.close(); }
  }, 20000);
  it("la cadena Auth → profiles → persons ignora metadatos de privilegios o identidades ajenas", async () => {
    const user = "30000000-0000-4000-8000-000000000001";
    const original = await person(a);
    await db.query("insert into auth.users(id,email_confirmed_at,raw_user_meta_data) values ($1,now(),$2)", [user, JSON.stringify({ display_name: "Ana", user_id: a, person_id: original, role: "admin" })]);
    const profile = await queryAs<{ user_id: string }>(user, "select user_id from profiles");
    expect(profile.rows).toEqual([{ user_id: user }]);
    const identity = await person(user);
    expect(identity).not.toBe(original);
    const rows = await queryAs<{ user_id: string; created_by: string }>(user, "select user_id,created_by from persons where id=$1", [identity]);
    expect(rows.rows).toEqual([{ user_id: user, created_by: user }]);
    expect((await queryAs(user, "select * from group_members")).rows).toHaveLength(0);
  });
  it("asocia una sola persona por cuenta y extiende el alta de profiles", async () => {
    const id = await person(a);
    expect(await person(a)).toBe(id);
    const own = await queryAs<{ count: number }>(a, "select count(*)::int as count from persons where user_id=$1", [a]);
    expect(own.rows[0].count).toBe(1);
    const newUser = "00000000-0000-4000-8000-000000000004";
    await db.query("insert into auth.users(id,email_confirmed_at) values ($1,now())", [newUser]);
    expect(await person(newUser)).toBeTruthy();
  });
  it("crea grupo, administrador e historial en una misma transacción", async () => {
    const group = await create();
    const members = await queryAs<{ role: string; status: string }>(a, "select role,status from group_members where group_id=$1", [group]);
    expect(members.rows).toEqual([{ role: "admin", status: "active" }]);
    expect((await queryAs(a, "select * from group_events where group_id=$1", [group])).rows).toHaveLength(1);
    await expect(rpc(a, "tuki_create_group", ["", "", "permanent"])).rejects.toThrow();
  });
  it("oculta grupos, miembros, eventos e invitaciones a usuarios ajenos", async () => {
    const group = await create();
    for (const table of ["groups", "group_members", "group_events"]) {
      const column = table === "groups" ? "id" : "group_id";
      expect((await queryAs(b, `select * from ${table} where ${column}=$1`, [group])).rows).toHaveLength(0);
    }
    expect((await queryAs(b, "select id from group_invitations where group_id=$1", [group])).rows).toHaveLength(0);
    await expect(rpc(b, "tuki_update_group", [group, "Ajeno", "", "temporary"])).rejects.toThrow("group_forbidden");
    await expect(queryAs(b, "update groups set name='Ajeno' where id=$1", [group])).rejects.toThrow(/permission denied/);
  });
  it("crea invitados sin cuenta y permite reutilizar su ID en varios grupos", async () => {
    const first = await create(); const second = await create();
    const guest = await rpc(a, "tuki_add_guest", [first, "Invitado", null]);
    expect(await rpc(a, "tuki_add_guest", [second, null, guest])).toBe(guest);
    const row = await queryAs<{ user_id: string | null; id: string }>(a, "select id,user_id from persons where id=$1", [guest]);
    expect(row.rows[0]).toEqual({ id: guest, user_id: null });
    expect((await queryAs(a, "select * from group_members where person_id=$1", [guest])).rows).toHaveLength(2);
    expect((await queryAs(b, "select * from persons where id=$1", [guest])).rows).toHaveLength(0);
    await expect(rpc(a, "tuki_add_guest", [first, null, guest])).rejects.toThrow("member_exists");
    const sameName = await rpc(a, "tuki_add_guest", [first, "Invitado", null]);
    expect(sameName).not.toBe(guest);
  });
  it("no permite reclamar identidades ni reutilizar invitados ajenos conociendo el ID", async () => {
    const first = await create(); const other = await create(b);
    const guest = await rpc(a, "tuki_add_guest", [first, "Sin cuenta", null]);
    await expect(rpc(b, "tuki_add_guest", [other, null, guest])).rejects.toThrow("person_forbidden");
    await expect(queryAs(b, "update persons set user_id=$1 where id=$2", [b, guest])).rejects.toThrow(/permission denied/);
    await expect(queryAs(a, "update persons set merged_into=$1 where id=$2", [await person(a), guest])).rejects.toThrow(/permission denied/);
    await rpc(a, "tuki_rename_guest", [first, guest, "Nombre corregido"]);
    expect((await queryAs<{ display_name: string }>(a, "select display_name from persons where id=$1", [guest])).rows[0].display_name).toBe("Nombre corregido");
  });
  it("reutiliza la identidad de cuenta al aceptar, sin reclamar un invitado homónimo", async () => {
    const first = await create(); const second = await create();
    const guest = await rpc(a, "tuki_add_guest", [first, "Beto", null]);
    const identity = await person(b);
    const one = await invite(first); const two = await invite(second);
    expect(await rpc(b, "tuki_accept_invitation", [one.raw])).toBe(first);
    expect(await rpc(b, "tuki_accept_invitation", [two.raw])).toBe(second);
    expect(await person(b)).toBe(identity);
    expect(identity).not.toBe(guest);
    expect((await queryAs<{ user_id: null }>(a, "select user_id from persons where id=$1", [guest])).rows[0].user_id).toBeNull();
  });
});

describe("invitaciones y administración SQL", () => {
  it("un enlace anterior o nuevo no reactiva a una persona retirada ni consume el token", async () => {
    const group = await create();
    const oldLink = await invite(group);
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    const bPerson = await person(b);
    await rpc(a, "tuki_set_member", [group, bPerson, "member", "retired"]);
    const newLink = await invite(group);
    const before = await queryAs(a, "select role,status,retired_at,joined_at from group_members where group_id=$1 and person_id=$2", [group,bPerson]);
    for (const link of [oldLink, newLink]) {
      await expect(rpc(b, "tuki_accept_invitation", [link.raw])).rejects.toThrow("member_retired");
      const invitation = await queryAs<{ accepted_at: string | null }>(a, "select accepted_at from group_invitations where id=$1", [link.id]);
      expect(invitation.rows[0].accepted_at).toBeNull();
    }
    expect((await queryAs(a, "select role,status,retired_at,joined_at from group_members where group_id=$1 and person_id=$2", [group,bPerson])).rows).toEqual(before.rows);
    expect((await queryAs(b, "select id from groups where id=$1", [group])).rows).toHaveLength(0);
    await rpc(a, "tuki_set_member", [group, bPerson, "member", "active"]);
    expect((await queryAs(b, "select id from groups where id=$1", [group])).rows).toHaveLength(1);
  });
  it("el reintento del mismo enlace respeta vencimiento y archivo aunque ya se haya consumido", async () => {
    const group = await create(); const link = await invite(group);
    await rpc(b, "tuki_accept_invitation", [link.raw]);
    await rpc(a, "tuki_archive_group", [group,true]);
    await expect(rpc(b, "tuki_accept_invitation", [link.raw])).rejects.toThrow("group_archived");
    await rpc(a, "tuki_archive_group", [group,false]);
    await db.query("update group_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[link.id]);
    await expect(rpc(b, "tuki_accept_invitation", [link.raw])).rejects.toThrow("invitation_expired");
  });
  it("un miembro normal no puede retirar a otra persona ni reactivarse luego del retiro", async () => {
    const group = await create();
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    await expect(rpc(b, "tuki_set_member", [group,await person(a),"member","retired"])).rejects.toThrow("group_forbidden");
    const bPerson = await person(b);
    await rpc(b, "tuki_set_member", [group,bPerson,"member","retired"]);
    await expect(rpc(b, "tuki_set_member", [group,bPerson,"member","active"])).rejects.toThrow("group_forbidden");
  });
  it("un enlace admite al participante pendiente, sin cambiar su identidad ni rol", async () => {
    const group = await create();
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    const bPerson = await person(b);
    await rpc(a, "tuki_set_member", [group, bPerson, "member", "invited"]);
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    const membership = await queryAs<{ person_id: string; role: string; status: string }>(a, "select person_id,role,status from group_members where group_id=$1 and person_id=$2", [group, bPerson]);
    expect(membership.rows).toEqual([{ person_id: bPerson, role: "member", status: "active" }]);
  });
  it.each([
    ["admin", "active", true], ["admin", "retired", true], ["admin", "invited", false],
    ["member", "active", true], ["member", "retired", true], ["member", "invited", true],
    [null, "active", false], ["member", null, false], ["invalid", "active", false], ["member", "invalid", false],
  ])("valida combinación SQL rol=%s estado=%s (válida=%s)", async (role, status, valid) => {
    const group = await create();
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    const bPerson = await person(b);
    const change = rpc(a, "tuki_set_member", [group, bPerson, role, status]);
    if (valid) {
      await change;
      const row = await queryAs<{ role: string; status: string; retired_at: string | null }>(a, "select role,status,retired_at from group_members where group_id=$1 and person_id=$2", [group, bPerson]);
      expect(row.rows[0]).toMatchObject({ role, status });
      expect(row.rows[0].retired_at !== null).toBe(status === "retired");
    } else await expect(change).rejects.toThrow("invalid_member_state");
  });
  it.each([
    ["admin", "active"], ["admin", "retired"], ["member", "active"], ["member", "retired"], ["member", "invited"],
  ])("un miembro no puede escalar permisos con rol=%s estado=%s", async (role, status) => {
    const group = await create();
    await rpc(b, "tuki_accept_invitation", [(await invite(group)).raw]);
    const change = rpc(b, "tuki_set_member", [group, await person(b), role, status]);
    if (role === "member" && status === "retired") await change;
    else await expect(change).rejects.toThrow("group_forbidden");
  });
  it.each([
    ["admin", "retired"], ["member", "active"], ["member", "retired"], ["member", "invited"],
  ])("el último administrador no puede pasar a %s/%s", async (role, status) => {
    const group = await create();
    await expect(rpc(a, "tuki_set_member", [group, await person(a), role, status])).rejects.toThrow("last_admin");
    expect((await queryAs<{ role: string; status: string }>(a, "select role,status from group_members where group_id=$1", [group])).rows).toEqual([{ role: "admin", status: "active" }]);
  });
  it("las identidades retiradas solo son visibles por autorización independiente o administración", async () => {
    const owner = "20000000-0000-4000-8000-000000000001";
    const former = "20000000-0000-4000-8000-000000000002";
    const reader = "20000000-0000-4000-8000-000000000003";
    for (const user of [owner, former, reader]) await db.query("insert into auth.users(id,email_confirmed_at) values ($1,now())", [user]);
    const group = await create(owner);
    await rpc(former, "tuki_accept_invitation", [(await invite(group, owner)).raw]);
    await rpc(reader, "tuki_accept_invitation", [(await invite(group, owner)).raw]);
    const formerPerson = await person(former);
    expect((await queryAs(reader, "select id from persons where id=$1", [formerPerson])).rows).toHaveLength(1);
    await rpc(owner, "tuki_set_member", [group, formerPerson, "member", "retired"]);
    expect((await queryAs(reader, "select id from persons where id=$1", [formerPerson])).rows).toHaveLength(0);
    expect((await queryAs(owner, "select id from persons where id=$1", [formerPerson])).rows).toHaveLength(1);
    expect((await queryAs(former, "select id from persons where id=$1", [formerPerson])).rows).toHaveLength(1);
    expect((await queryAs(former, "select * from group_events where group_id=$1", [group])).rows).toHaveLength(0);
    // Membership history remains, but cannot be used as a global person directory.
    expect((await queryAs(reader, "select person_id from group_members where group_id=$1 and person_id=$2", [group, formerPerson])).rows).toHaveLength(1);
    const guest = await rpc(owner, "tuki_add_guest", [group, "Privado", null]);
    await rpc(owner, "tuki_set_member", [group, guest, "member", "retired"]);
    expect((await queryAs(reader, "select id from persons where id=$1", [guest])).rows).toHaveLength(0);
    expect((await queryAs(owner, "select id from persons where id=$1", [guest])).rows).toHaveLength(1);
    const other = await create(owner);
    await rpc(former, "tuki_accept_invitation", [(await invite(other, owner)).raw]);
    await rpc(reader, "tuki_accept_invitation", [(await invite(other, owner)).raw]);
    expect((await queryAs(reader, "select id from persons where id=$1", [formerPerson])).rows).toHaveLength(1);
  });
  it("los permisos de schema y funciones no dejan EXECUTE público ni escritura interna", async () => {
    const functions = await db.query<{ nspname: string; proname: string; prosecdef: boolean; proconfig: string[]; anon_execute: boolean; auth_execute: boolean; public_execute: boolean }>(`
      select n.nspname,p.proname,p.prosecdef,p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
        has_function_privilege('authenticated',p.oid,'EXECUTE') as auth_execute,
        exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where acl.grantee=0 and acl.privilege_type='EXECUTE') as public_execute
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='tuki_private' or (n.nspname='public' and p.proname like 'tuki_%')`);
    expect(functions.rows.length).toBeGreaterThan(10);
    for (const fn of functions.rows) {
      expect(fn.prosecdef).toBe(true);
      expect(fn.proconfig).toContain('search_path=""');
      expect(fn.anon_execute).toBe(false);
      expect(fn.public_execute).toBe(false);
      const internalWrite = ["profile_person", "lock_admin", "event", "tuki_create_account_profile"].includes(fn.proname);
      expect(fn.auth_execute).toBe(!internalWrite);
    }
    const schemas = await db.query<{ usage: boolean; create: boolean; anon_usage: boolean }>(`select
      has_schema_privilege('authenticated','tuki_private','USAGE') as usage,
      has_schema_privilege('authenticated','tuki_private','CREATE') as create,
      has_schema_privilege('anon','tuki_private','USAGE') as anon_usage`);
    expect(schemas.rows).toEqual([{ usage: true, create: false, anon_usage: false }]);
    await expect(queryAs(a, "select tuki_private.event(null,'created',null,'{}')")).rejects.toThrow(/permission denied/);
    await expect(queryAs(a, "select tuki_private.lock_admin(null,false)")).rejects.toThrow(/permission denied/);
    await expect(queryAs(a, "create function tuki_private.evil() returns int language sql as 'select 1'")).rejects.toThrow(/permission denied/);
  });
  it("restringe miembros normales, protege hashes y mantiene un administrador activo", async () => {
    const group = await create(); const link = await invite(group);
    await rpc(b, "tuki_accept_invitation", [link.raw]);
    expect((await queryAs(b, "select id from group_invitations where group_id=$1", [group])).rows).toHaveLength(0);
    await expect(rpc(b, "tuki_create_invitation", [group, hash(token()), 72])).rejects.toThrow("group_forbidden");
    await expect(rpc(b, "tuki_archive_group", [group, true])).rejects.toThrow("group_forbidden");
    await expect(queryAs(a, "select token_hash from group_invitations where group_id=$1", [group])).rejects.toThrow(/permission denied/);
    await expect(rpc(a, "tuki_set_member", [group, await person(a), "member", "active"])).rejects.toThrow("last_admin");
    await rpc(a, "tuki_set_member", [group, await person(b), "admin", "active"]);
    await rpc(a, "tuki_set_member", [group, await person(a), "member", "active"]);
    await expect(rpc(a, "tuki_update_group", [group, "No", "", "permanent"])).rejects.toThrow("group_forbidden");
    await rpc(b, "tuki_update_group", [group, "Nuevo nombre", "Actualizado", "temporary"]);
  });
  it("rechaza invitaciones vencidas, revocadas y ya consumidas", async () => {
    const group = await create();
    const expired = await invite(group);
    await db.query("update group_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1", [expired.id]);
    await expect(rpc(b, "tuki_accept_invitation", [expired.raw])).rejects.toThrow("invitation_expired");
    const revoked = await invite(group); await rpc(a, "tuki_revoke_invitation", [group, revoked.id]);
    await expect(rpc(b, "tuki_accept_invitation", [revoked.raw])).rejects.toThrow("invitation_revoked");
    const used = await invite(group); await rpc(b, "tuki_accept_invitation", [used.raw]);
    expect(await rpc(b, "tuki_accept_invitation", [used.raw])).toBe(group);
    await expect(rpc(c, "tuki_accept_invitation", [used.raw])).rejects.toThrow("invitation_used");
    await expect(rpc(c, "tuki_accept_invitation", [hash(used.raw)])).rejects.toThrow("invitation_unavailable");
  });
  it("retira sin borrar, limita nombres/roles de invitados y permite reactivar", async () => {
    const group = await create(); const guest = await rpc(a, "tuki_add_guest", [group, "Participante", null]);
    await expect(rpc(a, "tuki_set_member", [group, guest, "admin", "active"])).rejects.toThrow("admin_requires_account");
    await rpc(a, "tuki_set_member", [group, guest, "member", "retired"]);
    const audit = await queryAs<{ details: Record<string, string> }>(a, "select details from group_events where group_id=$1 and subject_id=$2 and event_type='member_changed'", [group, guest]);
    expect(audit.rows[0].details).toEqual({ role_before: "member", role_after: "member", status_before: "active", status_after: "retired" });
    expect((await queryAs(a, "select id from persons where id=$1", [guest])).rows).toHaveLength(1);
    await expect(rpc(a, "tuki_add_guest", [group, null, guest])).rejects.toThrow("member_exists");
    await rpc(a, "tuki_set_member", [group, guest, "member", "active"]);
    const link = await invite(group); await rpc(b, "tuki_accept_invitation", [link.raw]);
    await rpc(b, "tuki_set_member", [group, await person(b), "member", "retired"]);
    expect((await queryAs(b, "select id from groups where id=$1", [group])).rows).toHaveLength(0);
  });
  it("archiva conservando membresías e historial y bloquea cambios hasta restaurar", async () => {
    const group = await create(); const link = await invite(group);
    await rpc(a, "tuki_archive_group", [group, true]);
    expect((await queryAs(a, "select * from group_members where group_id=$1", [group])).rows).toHaveLength(1);
    await expect(rpc(a, "tuki_add_guest", [group, "No", null])).rejects.toThrow("group_archived");
    await expect(rpc(b, "tuki_accept_invitation", [link.raw])).rejects.toThrow("group_archived");
    await rpc(a, "tuki_archive_group", [group, false]);
    await rpc(b, "tuki_accept_invitation", [link.raw]);
    expect((await queryAs(a, "select id from group_events where group_id=$1", [group])).rows.length).toBeGreaterThan(3);
  });
  it("niega lecturas/RPC a anon y no concede escritura directa de identidades", async () => {
    await expect(db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query("select * from persons"); })).rejects.toThrow(/permission denied/);
    await expect(db.transaction(async (tx) => { await tx.exec("set local role anon"); await tx.query("select public.tuki_ensure_person()"); })).rejects.toThrow(/permission denied/);
    await expect(queryAs(a, "insert into persons(display_name) values ('No')")).rejects.toThrow(/permission denied/);
  });
  it("mantiene los perfiles de la Fase 2 aislados y no permite operar sin confirmar email", async () => {
    expect((await queryAs(a, "select user_id from profiles where user_id=$1", [b])).rows).toHaveLength(0);
    const unconfirmed = "00000000-0000-4000-8000-000000000099";
    await db.query("insert into auth.users(id) values ($1)", [unconfirmed]);
    await expect(create(unconfirmed)).rejects.toThrow("authentication_required");
  });
  it("serializa solicitudes paralelas y no duplica incorporaciones ni consume dos veces", async () => {
    const group = await create(); const link = await invite(group);
    const outcomes = await Promise.allSettled([rpc(b, "tuki_accept_invitation", [link.raw]), rpc(c, "tuki_accept_invitation", [link.raw])]);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const members = await queryAs(a, "select * from group_members where group_id=$1", [group]);
    expect(members.rows).toHaveLength(2);
    // This verifies interleaved application requests, not two PostgreSQL sessions.
  });
});

describe("corrección local de invitados duplicados", () => {
  async function setup() {
    const group = await create(); const other = await create();
    const source = await rpc(a, "tuki_add_guest", [group,"Mati",null]);
    const target = await rpc(a, "tuki_add_guest", [other,"Mati",null]);
    return { group, other, source, target };
  }
  const replace = (group: string, source: string, target: string, user = a, confirm = true) => rpc(user, "tuki_replace_guest", [group,source,target,confirm]);
  it("reemplaza solo en el grupo elegido, conservando identidades, otros grupos e historial", async () => {
    const { group, other, source, target } = await setup();
    await rpc(a, "tuki_add_guest", [other,null,source]);
    const otherBefore = await queryAs(a, "select * from group_members where group_id=$1 order by person_id", [other]);
    const otherEvents = await queryAs(a, "select * from group_events where group_id=$1 order by id", [other]);
    const oldEvents = await queryAs(a, "select * from group_events where group_id=$1 order by id", [group]);
    const link = await invite(group);
    const invitesBefore = await queryAs(a, "select id,accepted_at,revoked_at,expires_at from group_invitations where group_id=$1", [group]);
    await replace(group,source,target);
    const rows = await queryAs<{ person_id: string; status: string; replaced_by_person_id: string | null }>(a, "select person_id,status,replaced_by_person_id from group_members where group_id=$1",[group]);
    expect(rows.rows).toContainEqual({ person_id: source, status: "retired", replaced_by_person_id: target });
    expect(rows.rows).toContainEqual({ person_id: target, status: "active", replaced_by_person_id: null });
    expect((await queryAs(a,"select * from group_members where group_id=$1 order by person_id",[other])).rows).toEqual(otherBefore.rows);
    expect((await queryAs(a,"select * from group_events where group_id=$1 order by id",[other])).rows).toEqual(otherEvents.rows);
    const events = (await queryAs<{ event_type: string; details: Record<string, unknown> }>(a,"select * from group_events where group_id=$1 order by id",[group])).rows;
    expect(events.filter((event) => event.event_type !== "guest_replaced").slice(0,oldEvents.rows.length)).toEqual(oldEvents.rows);
    expect(events.at(-1)).toMatchObject({ event_type: "guest_replaced", details: { source_person_id: source, target_person_id: target } });
    expect((await queryAs(a,"select id,accepted_at,revoked_at,expires_at from group_invitations where group_id=$1",[group])).rows).toEqual(invitesBefore.rows);
    expect((await queryAs(a,"select id from persons where id in ($1,$2)",[source,target])).rows).toHaveLength(2);
    await expect(rpc(a,"tuki_set_member",[group,source,"member","active"])).rejects.toThrow("membership_replaced");
    await expect(replace(group,source,target)).rejects.toThrow("correction_source_unavailable");
    await expect(db.query("delete from persons where id=$1",[source])).rejects.toThrow(/foreign key/);
    await expect(db.query("delete from group_members where group_id=$1 and person_id=$2",[group,target])).rejects.toThrow(/foreign key/);
    // Unrelated pending invites are unchanged and can still be accepted normally.
    await rpc(b,"tuki_accept_invitation",[link.raw]);
  });
  it("si el destino ya participa activo no lo duplica ni modifica su membresía", async () => {
    const { group, source, target } = await setup();
    await rpc(a,"tuki_add_guest",[group,null,target]);
    const before = await queryAs(a,"select * from group_members where group_id=$1 and person_id=$2",[group,target]);
    await replace(group,source,target);
    expect((await queryAs(a,"select * from group_members where group_id=$1 and person_id=$2",[group,target])).rows).toEqual(before.rows);
    expect((await queryAs(a,"select * from group_members where group_id=$1 and status='active'",[group])).rows).toHaveLength(2);
  });
  it("exige confirmación, administración y reutilización autorizada del destino", async () => {
    const { group, source, target } = await setup();
    await expect(replace(group,source,target,a,false)).rejects.toThrow("correction_confirmation_required");
    await expect(replace(group,source,source)).rejects.toThrow("invalid_input");
    await rpc(b,"tuki_accept_invitation",[(await invite(group)).raw]);
    await expect(replace(group,source,target,b)).rejects.toThrow("group_forbidden");
    const otherGroup = await create(b);
    const foreignGuest = await rpc(b,"tuki_add_guest",[otherGroup,"Mati",null]);
    await expect(replace(group,source,foreignGuest)).rejects.toThrow("person_forbidden");
  });
  it("no modifica ni usa cuentas registradas como origen o destino", async () => {
    const { group, source, target } = await setup();
    await rpc(b,"tuki_accept_invitation",[(await invite(group)).raw]);
    const account = await person(b);
    await expect(replace(group,account,target)).rejects.toThrow("person_forbidden");
    await expect(replace(group,source,account)).rejects.toThrow("person_forbidden");
    expect((await queryAs<{ user_id: string }>(b,"select user_id from persons where id=$1",[account])).rows[0].user_id).toBe(b);
  });
  it.each(["retired","invited"])("no reactiva un destino %s", async (status) => {
    const { group, source, target } = await setup();
    await rpc(a,"tuki_add_guest",[group,null,target]);
    await rpc(a,"tuki_set_member",[group,target,"member",status]);
    await expect(replace(group,source,target)).rejects.toThrow("correction_target_unavailable");
    expect((await queryAs<{ status: string }>(a,"select status from group_members where group_id=$1 and person_id=$2",[group,target])).rows[0].status).toBe(status);
  });
  it("bloquea grupos archivados e historial incompatible", async () => {
    const { group, source, target } = await setup();
    await rpc(a,"tuki_archive_group",[group,true]);
    await expect(replace(group,source,target)).rejects.toThrow("group_archived");
    await rpc(a,"tuki_archive_group",[group,false]);
    await rpc(a,"tuki_set_member",[group,source,"member","active"]);
    await expect(replace(group,source,target)).rejects.toThrow("correction_history_incompatible");
  });
  it("bloquea incluso tablas financieras sin FK, sin modificar registros", async () => {
    const { group, source, target } = await setup();
    await db.exec("create table public.test_financial_movements(id int primary key, amount int); insert into public.test_financial_movements values (1,500)");
    try {
      await expect(replace(group,source,target)).rejects.toThrow("correction_schema_changed");
      expect((await queryAs<{ status: string }>(a,"select status from group_members where group_id=$1 and person_id=$2",[group,source])).rows[0].status).toBe("active");
      expect((await db.query<{ amount: number }>("select amount from public.test_financial_movements")).rows[0].amount).toBe(500);
    } finally { await db.exec("drop table public.test_financial_movements"); }
  });
  it("bloquea referencias adicionales desde otro esquema", async () => {
    const { group, source, target } = await setup();
    await db.exec("create schema test_references; create table test_references.movements(person_id uuid references public.persons(id))");
    try { await expect(replace(group,source,target)).rejects.toThrow("correction_schema_changed"); }
    finally { await db.exec("drop table test_references.movements; drop schema test_references"); }
  });
  it("conserva ACL y bloquea acceso anónimo o escritura directa", async () => {
    const acl = await db.query<{ allowed: boolean; anon: boolean }>("select has_function_privilege('authenticated','public.tuki_replace_guest(uuid,uuid,uuid,boolean)','EXECUTE') as allowed, has_function_privilege('anon','public.tuki_replace_guest(uuid,uuid,uuid,boolean)','EXECUTE') as anon");
    expect(acl.rows).toEqual([{ allowed: true, anon: false }]);
    await expect(queryAs(a,"update group_members set replaced_by_person_id=null")).rejects.toThrow(/permission denied/);
  });
});
