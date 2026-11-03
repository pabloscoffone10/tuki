import { z } from "zod";
export const idSchema = z.uuid("El identificador no es válido.");
export const nameSchema = z.string().trim().min(1, "Ingresá un nombre.").max(80, "Usá hasta 80 caracteres.");
export const groupSchema = z.object({ name: nameSchema, description: z.string().trim().max(1000), kind: z.enum(["permanent", "temporary"]) });
export const editGroupSchema = groupSchema.extend({ groupId: idSchema });
export const guestSchema = z.object({ groupId: idSchema, mode: z.enum(["new", "existing"]), name: z.string().trim().max(80), personId: z.string() }).superRefine((value, ctx) => {
  if (value.mode === "new" && !value.name) ctx.addIssue({ code: "custom", path: ["name"], message: "Ingresá el nombre del invitado." });
  if (value.mode === "existing" && !idSchema.safeParse(value.personId).success) ctx.addIssue({ code: "custom", path: ["personId"], message: "Elegí una persona autorizada." });
});
export const memberSchema = z.object({ groupId: idSchema, personId: idSchema, role: z.enum(["admin", "member"]), status: z.enum(["active", "retired", "invited"]) }).refine((value) => value.role !== "admin" || value.status !== "invited", { path: ["status"], message: "Un administrador no puede estar pendiente de invitación." });
export const renameSchema = z.object({ groupId: idSchema, personId: idSchema, name: nameSchema });
export const archiveSchema = z.object({ groupId: idSchema, archived: z.enum(["true", "false"]), confirm: z.literal("yes", { error: "Confirmá la operación." }) });
export const invitationSchema = z.object({ groupId: idSchema, hours: z.coerce.number().int().min(1).max(168) });
export const revokeSchema = z.object({ groupId: idSchema, invitationId: idSchema });
export const tokenSchema = z.string().regex(/^[a-f0-9]{64}$/, "El enlace no es válido.");
export const replaceGuestSchema = z.object({ groupId: idSchema, sourcePersonId: idSchema, targetPersonId: idSchema, confirm: z.literal("yes", { error: "Confirmá la identidad de reemplazo." }) })
  .refine((value) => value.sourcePersonId !== value.targetPersonId, { path: ["targetPersonId"], message: "Elegí otra identidad invitada." });
