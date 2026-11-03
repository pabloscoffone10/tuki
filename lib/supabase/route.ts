import { createServerClient } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { requireSupabaseConfig } from "@/lib/env";
import { supabaseCookieOptions } from "./cookie-options";

// Bind session cookies (including chunks/deletions) to the actual redirect.
export function createRouteClient(request: NextRequest, response: NextResponse) {
  const config = requireSupabaseConfig();
  return createServerClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce" },
    cookieOptions: supabaseCookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookies, headers) {
        cookies.forEach(({ name, value, options }) => {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });
}
