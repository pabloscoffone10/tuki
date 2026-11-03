import type { Invitation, Member, Person } from "./types";
export function canManage(member: Pick<Member, "role" | "status"> | undefined, archived: boolean) {
  return member?.role === "admin" && member.status === "active" && !archived;
}
export function canRenameGuest(person: Pick<Person, "user_id" | "created_by" | "merged_into"> | null, userId: string) {
  return !!person && person.user_id === null && person.created_by === userId && person.merged_into === null;
}
export function invitationStatus(invitation: Pick<Invitation, "revoked_at" | "accepted_at" | "expires_at">, now: number = Date.now()) {
  if (invitation.revoked_at) return "Revocada";
  if (invitation.accepted_at) return "Aceptada";
  if (Date.parse(invitation.expires_at) <= now) return "Vencida";
  return "Disponible";
}
