import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabaseConfig } from "@/lib/env";
import { supabaseCookieOptions } from "./cookie-options";

// Server Components read cookies; proxy refreshes them before rendering.
export async function createReadOnlyClient() {
  const config = requireSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: supabaseCookieOptions,
    cookies: { getAll() { return cookieStore.getAll(); } },
  });
}

// Only call in Server Actions and Route Handlers, where writing is supported.
export async function createClient() {
  const config = requireSupabaseConfig();
  const cookieStore = await cookies();
  return createServerClient(config.url, config.publishableKey, {
    cookieOptions: supabaseCookieOptions,
    auth: { flowType: "pkce" },
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
