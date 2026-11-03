import "server-only";
import { redirect } from "next/navigation";
import { createReadOnlyClient } from "@/lib/supabase/server";

export async function requireUser() {
  const supabase = await createReadOnlyClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect("/login");
  return data.user;
}
