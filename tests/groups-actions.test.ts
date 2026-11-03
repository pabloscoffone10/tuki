import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), rpc: vi.fn(), redirect: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/features/auth/session", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://tuki.example" }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { acceptInvitation, addGuest, archiveGroup, createGroup, createInvitation, replaceGuest, updateGroup } from "@/features/groups/actions";
const groupId = "00000000-0000-4000-8000-000000000001";
const form = (values: Record<string, string>) => { const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); return data; };
beforeEach(() => {
  vi.resetAllMocks(); mocks.requireUser.mockResolvedValue({ id: "user" });
  mocks.rpc.mockResolvedValue({ data: groupId, error: null });
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
});
it("exige confirmación e IDs distintos antes de corregir un duplicado", async () => {
  const other = "00000000-0000-4000-8000-000000000002";
  expect((await replaceGuest({}, form({ groupId, sourcePersonId: groupId, targetPersonId: other }))).error).toBeDefined();
  expect((await replaceGuest({}, form({ groupId, sourcePersonId: groupId, targetPersonId: groupId, confirm: "yes" }))).error).toBeDefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
  const state = await replaceGuest({}, form({ groupId, sourcePersonId: groupId, targetPersonId: other, confirm: "yes", userId: "attacker" }));
  expect(mocks.requireUser).toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("tuki_replace_guest", { p_group_id: groupId, p_source_person_id: groupId, p_target_person_id: other, p_confirm: true });
  expect(state.success).toContain("solo en este grupo");
});
it("crea grupos después de verificar la sesión, sin aceptar un administrador enviado por el cliente", async () => {
  await expect(createGroup({}, form({ name: "Viaje", description: "", kind: "temporary", createdBy: "attacker" }))).rejects.toThrow("REDIRECT");
  expect(mocks.requireUser).toHaveBeenCalled();
  expect(mocks.rpc).toHaveBeenCalledWith("tuki_create_group", { p_name: "Viaje", p_description: "", p_kind: "temporary" });
  expect(mocks.redirect).toHaveBeenCalledWith(`/grupos/${groupId}`);
});
it("no ejecuta RPC si falta sesión o los datos son inválidos", async () => {
  expect((await createGroup({}, form({ name: "", description: "", kind: "permanent" }))).error).toBeDefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.requireUser.mockRejectedValue(new Error("REDIRECT"));
  await expect(updateGroup({}, form({}))).rejects.toThrow("REDIRECT");
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("no transforma un nombre de invitado en una identidad existente", async () => {
  await addGuest({}, form({ groupId, mode: "new", name: "Ana", personId: groupId }));
  expect(mocks.rpc).toHaveBeenCalledWith("tuki_add_guest", { p_group_id: groupId, p_name: "Ana", p_person_id: null });
});
it("genera un token aleatorio y persiste solamente su hash", async () => {
  const state = await createInvitation({}, form({ groupId, hours: "72" }));
  const raw = new URL(state.invitationUrl!).pathname.split("/").at(-1)!;
  expect(raw).toMatch(/^[a-f0-9]{64}$/);
  expect(mocks.rpc).toHaveBeenCalledWith("tuki_create_invitation", { p_group_id: groupId, p_token_hash: createHash("sha256").update(raw).digest("hex"), p_hours: 72 });
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(raw);
});
it("confirma la aceptación usando la identidad de sesión y trata expiración segura", async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: "invitation_expired" } });
  const result = await acceptInvitation({}, form({ token: "a".repeat(64), confirm: "yes", personId: "arbitrary-guest" }));
  expect(mocks.rpc).toHaveBeenCalledWith("tuki_accept_invitation", { p_token: "a".repeat(64) });
  expect(result.error).toContain("venció");
});
it("no archiva sin confirmación y explica una migración pendiente", async () => {
  expect((await archiveGroup({}, form({ groupId, archived: "true" }))).error).toBeDefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "private-schema-details" } });
  expect((await createGroup({}, form({ name: "Grupo", description: "", kind: "permanent" }))).error).toContain("migración");
});
