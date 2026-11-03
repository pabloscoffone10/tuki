// Account profile only. Future persons will reference this auth user separately;
// a profile is never an invited person or a membership in a group.
export type AccountProfile = { user_id: string; display_name: string; created_at: string };
