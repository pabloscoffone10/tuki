export type Person = { id: string; display_name: string; user_id: string | null; created_by: string | null; merged_into: string | null; created_at: string; updated_at: string };
export type Group = { id: string; name: string; description: string; kind: "permanent" | "temporary"; created_by: string; created_at: string; updated_at: string; archived_at: string | null; had_financial_activity?: boolean };
export type Member = { group_id: string; person_id: string; role: "admin" | "member"; status: "active" | "retired" | "invited"; joined_at: string; updated_at: string; retired_at: string | null; person: Person | null; replaced_by_person_id?: string | null; replaced_at?: string | null };
export type ReusableGuest = Person & { memberships: { group_id: string; group: { id: string; name: string } | null }[] };
export type Invitation = { id: string; group_id: string; created_by: string; created_at: string; expires_at: string; revoked_at: string | null; accepted_at: string | null; accepted_by: string | null };
export type GroupEvent = { id: number; event_type: string; created_at: string; details: Record<string, unknown>; subject: { display_name: string } | null };
export type GroupState = { error?: string; success?: string; fields?: Record<string, string[] | undefined>; invitationUrl?: string };
