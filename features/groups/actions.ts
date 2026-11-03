"use server";
import { randomBytes, createHash } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { groupError } from "./errors";
import { archiveSchema, editGroupSchema, groupSchema, guestSchema, invitationSchema, memberSchema, renameSchema, replaceGuestSchema, revokeSchema, tokenSchema } from "./schemas";
import type { GroupState } from "./types";

function refresh(groupId?: string) {
  revalidatePath("/grupos");
  revalidatePath("/");
  if (groupId) revalidatePath(`/grupos/${groupId}`);
}
async function mutate(name: string, args: Record<string, unknown>) {
  // Authenticated publishable-key client only. RPC rechecks permissions/locks.
  const client = await createClient();
  const { data, error } = await client.rpc(name, args);
  return { data: data as unknown, error: error ? groupError(error) : undefined };
}
const unavailable = { error: "No pudimos conectar con los grupos. Volvé a intentar." };

export async function replaceGuest(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = replaceGuestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Elegí y confirmá la identidad correcta.", fields: parsed.error.flatten().fieldErrors };
  try {
    const client = await createClient();
    const { groupId, sourcePersonId, targetPersonId } = parsed.data;
    const { error } = await client.rpc("tuki_replace_guest", { p_group_id: groupId, p_source_person_id: sourcePersonId, p_target_person_id: targetPersonId, p_confirm: true });
    if (error?.code === "PGRST202") return { error: "Aplicá la migración 202611020003_replace_duplicate_guest.sql para habilitar esta corrección." };
    if (error) return { error: groupError(error) };
    refresh(groupId);
    return { success: "Invitado reemplazado solo en este grupo. La identidad anterior y su historial se conservaron." };
  } catch { return unavailable; }
}

export async function createGroup(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = groupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los datos del grupo.", fields: parsed.error.flatten().fieldErrors };
  let destination: string;
  try {
    const { data, error } = await mutate("tuki_create_group", { p_name: parsed.data.name, p_description: parsed.data.description, p_kind: parsed.data.kind });
    if (error) return { error };
    if (typeof data !== "string") return unavailable;
    destination = data;
  } catch { return unavailable; }
  refresh();
  redirect(`/grupos/${destination}`);
}
export async function updateGroup(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = editGroupSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los datos del grupo.", fields: parsed.error.flatten().fieldErrors };
  try {
    const { groupId, name, description, kind } = parsed.data;
    const { error } = await mutate("tuki_update_group", { p_group_id: groupId, p_name: name, p_description: description, p_kind: kind });
    if (error) return { error };
    refresh(groupId); return { success: "Grupo actualizado." };
  } catch { return unavailable; }
}
export async function archiveGroup(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = archiveSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Confirmá el cambio de archivo." };
  try {
    const { error } = await mutate("tuki_archive_group", { p_group_id: parsed.data.groupId, p_archived: parsed.data.archived === "true" });
    if (error) return { error };
    refresh(parsed.data.groupId); return { success: parsed.data.archived === "true" ? "Grupo archivado. Sus integrantes e historial se conservan." : "Grupo desarchivado." };
  } catch { return unavailable; }
}
export async function addGuest(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = guestSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá el participante.", fields: parsed.error.flatten().fieldErrors };
  try {
    const { groupId, mode, name, personId } = parsed.data;
    const { error } = await mutate("tuki_add_guest", { p_group_id: groupId, p_name: mode === "new" ? name : null, p_person_id: mode === "existing" ? personId : null });
    if (error) return { error };
    refresh(groupId); return { success: "Participante agregado con su identidad global." };
  } catch { return unavailable; }
}
export async function renameGuest(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = renameSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ingresá un nombre válido." };
  try {
    const { error } = await mutate("tuki_rename_guest", { p_group_id: parsed.data.groupId, p_person_id: parsed.data.personId, p_name: parsed.data.name });
    if (error) return { error };
    refresh(parsed.data.groupId); return { success: "Nombre global actualizado en todos sus grupos." };
  } catch { return unavailable; }
}
export async function changeMember(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = memberSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá el rol y el estado.", fields: parsed.error.flatten().fieldErrors };
  if (form.get("confirm") !== "yes") return { error: "Confirmá el cambio de rol o estado." };
  try {
    const { groupId, personId, role, status } = parsed.data;
    const { error } = await mutate("tuki_set_member", { p_group_id: groupId, p_person_id: personId, p_role: role, p_status: status });
    if (error) return { error };
    refresh(groupId);
  } catch { return unavailable; }
  // A self-retirement removes access immediately; redirect before rendering detail.
  const client = await createClient();
  const { data } = await client.from("groups").select("id").eq("id", parsed.data.groupId).maybeSingle();
  if (!data) redirect("/grupos");
  return { success: "Participación actualizada. La identidad y el historial se conservan." };
}
export async function createInvitation(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = invitationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Elegí un vencimiento de 1 a 168 horas." };
  try {
    const origin = getSiteUrl();
    const token = randomBytes(32).toString("hex");
    const hash = createHash("sha256").update(token).digest("hex");
    const { error } = await mutate("tuki_create_invitation", { p_group_id: parsed.data.groupId, p_token_hash: hash, p_hours: parsed.data.hours });
    if (error) return { error };
    refresh(parsed.data.groupId);
    return { success: "Enlace creado. Se muestra una sola vez; compartilo únicamente con su destinatario.", invitationUrl: `${origin}/invitaciones/${token}` };
  } catch { return unavailable; }
}
export async function revokeInvitation(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = revokeSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "La invitación no es válida." };
  try {
    const { error } = await mutate("tuki_revoke_invitation", { p_group_id: parsed.data.groupId, p_invitation_id: parsed.data.invitationId });
    if (error) return { error };
    refresh(parsed.data.groupId); return { success: "Invitación revocada." };
  } catch { return unavailable; }
}
export async function acceptInvitation(_state: GroupState, form: FormData): Promise<GroupState> {
  await requireUser();
  const parsed = tokenSchema.safeParse(form.get("token"));
  if (!parsed.success || form.get("confirm") !== "yes") return { error: "Confirmá que querés unirte con tu propia identidad." };
  let groupId: string;
  try {
    const { data, error } = await mutate("tuki_accept_invitation", { p_token: parsed.data });
    if (error) return { error };
    if (typeof data !== "string") return unavailable;
    groupId = data;
  } catch { return unavailable; }
  refresh(groupId);
  redirect(`/grupos/${groupId}`);
}
