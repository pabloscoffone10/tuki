// @vitest-environment node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const userA = "10000000-0000-4000-8000-000000000001";
const userB = "10000000-0000-4000-8000-000000000002";
const userC = "10000000-0000-4000-8000-000000000003";
const personA = "20000000-0000-4000-8000-000000000001";
const personB = "20000000-0000-4000-8000-000000000002";
const personC = "20000000-0000-4000-8000-000000000003";
const guestPerson = "20000000-0000-4000-8000-000000000004";
const groupA = "30000000-0000-4000-8000-000000000001";
const groupB = "30000000-0000-4000-8000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role authenticated;
    create role anon;
    create schema auth;
    create schema tuki_private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth, tuki_private to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    create table public.persons(id uuid primary key, user_id uuid unique, display_name text not null);
    create table public.groups(id uuid primary key, created_by uuid, archived_at timestamptz);
    create table public.group_members(group_id uuid, person_id uuid, role text, status text);
    create function tuki_private.current_person() returns uuid language sql stable security definer set search_path = '' as $$
      select id from public.persons where user_id = (select auth.uid())
    $$;
    create function tuki_private.is_member(g uuid) returns boolean language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.group_members where group_id = g and person_id = tuki_private.current_person() and status = 'active')
    $$;
    create function tuki_private.is_admin(g uuid) returns boolean language sql stable security definer set search_path = '' as $$
      select exists(select 1 from public.group_members where group_id = g and person_id = tuki_private.current_person() and status = 'active' and role = 'admin')
    $$;
    create function public.tuki_ensure_person() returns uuid language plpgsql security definer set search_path = '' as $$
      declare result uuid;
      begin
        result := tuki_private.current_person();
        if result is null then raise exception 'authentication_required' using errcode = '42501'; end if;
        return result;
      end
    $$;
    grant execute on function tuki_private.current_person(), tuki_private.is_member(uuid), tuki_private.is_admin(uuid), public.tuki_ensure_person() to authenticated;
    create table public.expense_revisions(expense_id uuid, version integer, title text, total_minor numeric);
    create table public.expense_events(id bigint generated always as identity, expense_id uuid, group_id uuid, actor_id uuid, kind text, version integer);
    create table public.payments(id uuid primary key, group_id uuid, payer_id uuid, receiver_id uuid, amount_minor numeric, scope text not null default 'group', selected_obligations uuid[] not null default '{}');
    create table public.obligations(id uuid primary key, group_id uuid);
    create table public.payment_allocations(payment_id uuid, obligation_id uuid);
    create table public.payment_events(id uuid primary key, payment_id uuid, actor_id uuid, action text);
    insert into auth.users values ('${userA}'), ('${userB}'), ('${userC}');
    insert into public.persons values
      ('${personA}', '${userA}', 'Ana'), ('${personB}', '${userB}', 'Beto'), ('${personC}', '${userC}', 'Cami');
    insert into public.persons values ('${guestPerson}', null, 'Invitado');
    insert into public.groups(id, created_by) values ('${groupA}', '${personA}'), ('${groupB}', '${personA}');
    insert into public.group_members values
      ('${groupA}', '${personA}', 'admin', 'active'), ('${groupA}', '${personB}', 'member', 'active'),
      ('${groupA}', '${guestPerson}', 'member', 'active'),
      ('${groupB}', '${personC}', 'admin', 'active');
  `);
  const migration = readFileSync(resolve("supabase/migrations/202611050001_group_chat.sql"), "utf8");
  await db.exec(migration);
}, 60000);

afterAll(async () => { await db?.close(); });

async function asUser<T = Record<string, unknown>>(userId: string, sql: string, values: unknown[] = []) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
    return tx.query<T>(sql, values);
  });
}

const send = (userId: string, groupId: string, clientId = randomUUID(), content = "Hola") =>
  asUser<{ message: Record<string, unknown> }>(userId,
    "select public.tuki_send_group_chat_message($1, $2, $3) as message", [groupId, clientId, content]);

describe("chat de grupo: permisos, persistencia e idempotencia", () => {
  it("persiste un mensaje una vez, rechaza cambios al reusar la clave y limita lecturas por grupo", async () => {
    const clientId = randomUUID();
    const first = await send(userA, groupA, clientId, "Hola grupo");
    const retry = await send(userA, groupA, clientId, "Hola grupo");
    expect(first.rows[0].message.id).toBe(retry.rows[0].message.id);
    await expect(send(userA, groupA, clientId, "Otro contenido")).rejects.toThrow("chat_idempotency_conflict");

    expect((await asUser(userB, "select id from public.group_chat_messages where group_id = $1", [groupA])).rows).toHaveLength(1);
    expect((await asUser(userC, "select id from public.group_chat_messages where group_id = $1", [groupA])).rows).toHaveLength(0);
    await expect(send(userC, groupA)).rejects.toThrow("group_forbidden");
    await expect(asUser(userB, "insert into public.group_chat_messages(group_id, sender_person_id, client_message_id, content, message_kind) values($1,$2,$3,'falso','user')",
      [groupA, personB, randomUUID()])).rejects.toThrow(/permission denied/);
  });

  it("exige mensaje válido, respeta archivo de grupo y permite leer su historial", async () => {
    const empty = randomUUID();
    await expect(send(userA, groupA, empty, "   ")).rejects.toThrow("chat_invalid_message");
    await expect(send(userA, groupA, randomUUID(), "x".repeat(2001))).rejects.toThrow("chat_invalid_message");
    await db.query("update public.groups set archived_at = now() where id = $1", [groupA]);
    await expect(send(userA, groupA)).rejects.toThrow("group_archived");
    expect((await asUser(userB, "select id from public.group_chat_messages where group_id = $1", [groupA])).rows).toHaveLength(1);
    await db.query("update public.groups set archived_at = null where id = $1", [groupA]);
    expect((await db.query<{ user_id: string | null }>("select user_id from public.persons where id = $1", [guestPerson])).rows[0].user_id).toBeNull();
    await expect(send(userC, groupA)).rejects.toThrow("group_forbidden");
  });

  it("revoca acceso al retirarse y aplica el límite básico contra envíos excesivos", async () => {
    await db.query("update public.group_members set status = 'retired' where group_id = $1 and person_id = $2", [groupA, personB]);
    await expect(send(userB, groupA)).rejects.toThrow("group_forbidden");
    expect((await asUser(userB, "select id from public.group_chat_messages where group_id = $1", [groupA])).rows).toHaveLength(0);
    await db.query("update public.group_members set status = 'active' where group_id = $1 and person_id = $2", [groupA, personB]);

    for (let index = 0; index < 12; index += 1) await send(userC, groupB, randomUUID(), `Mensaje ${index}`);
    await expect(send(userC, groupB, randomUUID(), "Demasiados mensajes")).rejects.toThrow("chat_rate_limited");
  });

  it("mantiene lectura y silencio por usuario y no cuenta mensajes propios como no leídos", async () => {
    const unreadBefore = await asUser<{ count: number }>(userB,
      "select public.tuki_group_chat_unread_count($1)::int as count", [groupA]);
    expect(unreadBefore.rows[0].count).toBe(1);
    await asUser(userB, "select public.tuki_group_chat_mark_read($1)", [groupA]);
    const unreadAfter = await asUser<{ count: number }>(userB,
      "select public.tuki_group_chat_unread_count($1)::int as count", [groupA]);
    expect(unreadAfter.rows[0].count).toBe(0);
    await asUser(userB, "select public.tuki_group_chat_set_muted($1, true)", [groupA]);
    expect((await asUser<{ muted: boolean }>(userB,
      "select muted from public.group_chat_preferences where group_id = $1 and person_id = $2", [groupA, personB])).rows[0].muted).toBe(true);
    expect((await asUser(userA, "select * from public.group_chat_preferences where group_id = $1", [groupA])).rows).toHaveLength(0);
  });

  it("marca borrados lógicamente y no elimina los eventos financieros de su fuente", async () => {
    const { rows } = await send(userA, groupA, randomUUID(), "Gasto y pago");
    const message = rows[0].message as { id: string };
    await asUser(userA, "select public.tuki_group_chat_delete_message($1, $2, true)", [groupA, message.id]);
    const deleted = await asUser<{ content: string; deleted_at: string | null }>(userB,
      "select content, deleted_at from public.group_chat_messages where id = $1", [message.id]);
    expect(deleted.rows[0].content).toBe("Mensaje eliminado");
    expect(deleted.rows[0].deleted_at).toBeTruthy();
    await expect(asUser(userB, "select public.tuki_group_chat_delete_message($1, $2, true)", [groupA, message.id]))
      .rejects.toThrow("chat_message_forbidden");
  });

  it("publica gastos y transiciones de pagos dentro de la transacción con clave idempotente", async () => {
    const expenseId = randomUUID();
    await db.query("insert into public.expense_revisions(expense_id, version, title, total_minor) values($1,1,'Cancha',340000)", [expenseId]);
    await db.query("insert into public.expense_events(expense_id, group_id, actor_id, kind, version) values($1,$2,$3,'created',1),($1,$2,$3,'created',1)",
      [expenseId, groupA, personA]);
    const expenseMessages = await db.query<{ content: string; system_event_key: string }>(
      "select content, system_event_key from public.group_chat_messages where group_id = $1 and system_event_key like 'expense:%'", [groupA]);
    expect(expenseMessages.rows).toHaveLength(1);
    expect(expenseMessages.rows[0].content).toContain("Ana agregó un gasto de $3400,00 · Cancha");

    const paymentId = randomUUID();
    await db.query("insert into public.payments(id, group_id, payer_id, receiver_id, amount_minor) values($1,$2,$3,$4,85000)", [paymentId, groupA, personB, personA]);
    await db.query("insert into public.payment_events values($1,$2,$3,'created')", [randomUUID(), paymentId, personB]);
    const paymentMessage = await db.query<{ content: string }>(
      "select content from public.group_chat_messages where group_id = $1 and system_event_key like 'payment:%'", [groupA]);
    expect(paymentMessage.rows[0].content).toContain("pendiente de confirmación");
    expect(paymentMessage.rows[0].content).toContain("$850,00");
    await db.query("insert into public.payment_events values($1,$2,$3,'confirm')", [randomUUID(), paymentId, personA]);
    const confirmedMessage = await db.query<{ content: string }>(
      "select content from public.group_chat_messages where group_id = $1 and system_event_key like 'payment:%' and content like '%confirmó%'", [groupA]);
    expect(confirmedMessage.rows[0].content).toContain("confirmó el pago");
  });

  it("preserva la protección de borrado seguro y el wrapper de limpieza de avatares", async () => {
    const known = await db.query<{ known: boolean }>("select tuki_private.removal_schema_known() as known");
    expect(known.rows[0].known).toBe(true);
    const sql = readFileSync(resolve("supabase/migrations/202611050001_group_chat.sql"), "utf8");
    expect(sql).toContain("create or replace function tuki_private.delete_group_before_avatar");
    expect(sql).not.toContain("create or replace function public.tuki_delete_group");
    expect(sql.indexOf("delete from public.group_chat_messages")).toBeLessThan(sql.indexOf("delete from public.groups where id = p_group_id"));
  });
});
