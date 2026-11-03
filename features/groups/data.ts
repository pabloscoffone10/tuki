import "server-only";
import { requireUser } from "@/features/auth/session";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { groupError } from "./errors";
import type { Group, GroupEvent, Invitation, Member, ReusableGuest } from "./types";

export async function listGroups() {
  await requireUser();
  const supabase = await createReadOnlyClient();
  const { data, error } = await supabase.from("groups").select("*").order("created_at", { ascending: false }).returns<Group[]>();
  return { groups: data || [], error: error ? groupError(error) : undefined };
}

export async function getGroup(groupId: string, options: {people?:boolean;invitations?:boolean;events?:boolean}={}) {
  const user = await requireUser();
  const supabase = await createReadOnlyClient();
  const { data: group, error } = await supabase.from("groups").select("*").eq("id", groupId).maybeSingle<Group>();
  if (error) return { error: groupError(error) };
  if (!group) return { notFound: true as const };
  const { data: members, error: membersError } = await supabase.from("group_members").select("*, person:persons!group_members_person_id_fkey(*)").eq("group_id", groupId).order("joined_at").returns<Member[]>();
  if (membersError) return { error: groupError(membersError) };
  const me = members?.find((member) => member.person?.user_id === user.id);
  const admin = me?.role === "admin" && me.status === "active";
  const [{ data: people, error: peopleError }, { data: invitations, error: invitationsError }, { data: events, error: eventsError }] = await Promise.all([
    admin && options.people!==false ? supabase.from("persons").select("*, memberships:group_members(group_id,group:groups(id,name))").eq("created_by", user.id).is("user_id", null).is("merged_into", null).order("display_name").returns<ReusableGuest[]>() : Promise.resolve({ data: [] as ReusableGuest[], error: null }),
    admin && options.invitations!==false ? supabase.from("group_invitations").select("id,group_id,created_by,created_at,expires_at,revoked_at,accepted_at,accepted_by").eq("group_id", groupId).order("created_at", { ascending: false }).returns<Invitation[]>() : Promise.resolve({ data: [] as Invitation[], error: null }),
    options.events!==false ? supabase.from("group_events").select("id,event_type,created_at,details,subject:persons!group_events_subject_id_fkey(display_name)").eq("group_id", groupId).order("created_at", { ascending: false }).limit(30).returns<GroupEvent[]>() : Promise.resolve({data:[] as GroupEvent[],error:null}),
  ]);
  const extraError = peopleError || invitationsError || eventsError;
  if (extraError) return { error: groupError(extraError) };
  return { group, members: members || [], me, admin, userId: user.id, people: (people || []).filter((person) => !members?.some((member) => member.person_id === person.id)), replacementPeople: (people || []).filter((person) => !members?.some((member) => member.person_id === person.id && member.status !== "active")), invitations: invitations || [], events: events || [] };
}
