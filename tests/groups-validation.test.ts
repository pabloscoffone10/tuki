import { describe, expect, it } from "vitest";
import { archiveSchema, groupSchema, guestSchema, invitationSchema, memberSchema, tokenSchema } from "@/features/groups/schemas";
import { canManage, canRenameGuest, invitationStatus } from "@/features/groups/permissions";
import { safeNext } from "@/features/auth/redirects";
const groupId = "00000000-0000-4000-8000-000000000001";
describe("formularios y permisos de grupos", () => {
  it("valida grupos permanentes y temporales", () => {
    expect(groupSchema.parse({ name: " Viaje ", description: "", kind: "temporary" }).name).toBe("Viaje");
    expect(groupSchema.safeParse({ name: " ", description: "", kind: "permanent" }).success).toBe(false);
    expect(groupSchema.safeParse({ name: "Grupo", description: "", kind: "otro" }).success).toBe(false);
  });
  it("distingue crear un invitado de reutilizar una identidad autorizada", () => {
    expect(guestSchema.safeParse({ groupId, mode: "new", name: "Ana", personId: "" }).success).toBe(true);
    expect(guestSchema.safeParse({ groupId, mode: "existing", name: "Ana", personId: "" }).success).toBe(false);
    expect(guestSchema.safeParse({ groupId, mode: "existing", name: "", personId: groupId }).success).toBe(true);
    expect(canRenameGuest({ user_id: null, created_by: "owner", merged_into: null }, "other")).toBe(false);
    expect(canRenameGuest({ user_id: "owner", created_by: "owner", merged_into: null }, "owner")).toBe(false);
    expect(canRenameGuest(null, "owner")).toBe(false);
  });
  it("exige confirmación para archivar y no permite rol admin pendiente", () => {
    expect(archiveSchema.safeParse({ groupId, archived: "true" }).success).toBe(false);
    expect(memberSchema.safeParse({ groupId, personId: groupId, role: "admin", status: "invited" }).success).toBe(false);
    expect(canManage({ role: "admin", status: "active" }, false)).toBe(true);
    expect(canManage({ role: "member", status: "active" }, false)).toBe(false);
    expect(canManage({ role: "admin", status: "active" }, true)).toBe(false);
  });
  it("valida tokens y vencimientos sin aceptar destinos externos", () => {
    expect(tokenSchema.safeParse("a".repeat(64)).success).toBe(true);
    expect(tokenSchema.safeParse("nombre-conocido").success).toBe(false);
    expect(invitationSchema.safeParse({ groupId, hours: "169" }).success).toBe(false);
    expect(safeNext(`/invitaciones/${"a".repeat(64)}`)).toBe(`/invitaciones/${"a".repeat(64)}`);
    expect(safeNext(`/invitaciones/${"a".repeat(64)}?next=//evil`)).toBe("/");
    expect(invitationStatus({ expires_at: "2020-01-01T00:00:00Z", revoked_at: null, accepted_at: null })).toBe("Vencida");
    expect(invitationStatus({ expires_at: "2099-01-01T00:00:00Z", revoked_at: "2026-01-01", accepted_at: null })).toBe("Revocada");
  });
});
