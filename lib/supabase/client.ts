"use client";
import { createBrowserClient } from "@supabase/ssr";
import { requireSupabaseConfig } from "@/lib/env";
import { supabaseCookieOptions } from "./cookie-options";

// Public publishable key only. SSR persists the PKCE verifier and session in cookies.
export function createClient() {
  const config = requireSupabaseConfig();
  return createBrowserClient(config.url, config.publishableKey, {
    cookieOptions: supabaseCookieOptions,
    auth: { flowType: "pkce" },
  });
}
