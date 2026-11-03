export function formatGroupDate(value: string) {
  return new Intl.DateTimeFormat("es-UY", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Montevideo" }).format(new Date(value));
}
export const eventLabels: Record<string, string> = {
  expense_created: "Gasto creado", expense_edited: "Gasto editado", expense_voided: "Gasto anulado", member_removed: "Participación eliminada del grupo",
  guest_replaced: "Invitado duplicado reemplazado en este grupo",
  created: "Grupo creado", edited: "Datos del grupo editados", archived: "Grupo archivado", restored: "Grupo desarchivado",
  guest_added: "Invitado creado", person_added: "Identidad existente agregada", guest_renamed: "Nombre de invitado actualizado",
  member_changed: "Rol o estado de participación actualizado", invitation_created: "Invitación generada", invitation_revoked: "Invitación revocada", invitation_accepted: "Invitación aceptada",
};
export function membershipChange(details: Record<string, unknown>) {
  const labels: Record<string, string> = { admin: "administrador", member: "miembro", active: "activo", retired: "retirado", invited: "invitado pendiente" };
  const label = (value: unknown) => typeof value === "string" ? labels[value] || "—" : "—";
  return `${label(details.role_before)} / ${label(details.status_before)} → ${label(details.role_after)} / ${label(details.status_after)}`;
}
