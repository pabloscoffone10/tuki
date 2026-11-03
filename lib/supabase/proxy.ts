import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requireSupabaseConfig } from "@/lib/env";
import { isPublicPath, loginDestination } from "@/features/auth/redirects";
import { supabaseCookieOptions } from "./cookie-options";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  // This exact machine endpoint authenticates its own cron credential and is
  // disabled by default. It must not depend on a browser session cookie.
  if(request.nextUrl.pathname==="/api/internal/reminders"){
    response.headers.set("Cache-Control","no-store");return response;
  }
  // The callback owns the exchange and its cookie writes. Do not race it with
  // a refresh of an older session before it consumes a one-time credential.
  if (["/auth/callback", "/auth/confirm"].includes(request.nextUrl.pathname)) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  }
  const config = requireSupabaseConfig();
  const supabase = createServerClient(config.url, config.publishableKey, {
    cookieOptions: supabaseCookieOptions,
    auth: { flowType: "pkce" },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        const previousCookies = response.cookies.getAll();
        response = NextResponse.next({ request });
        previousCookies.forEach((cookie) => response.cookies.set(cookie));
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // getUser checks the Auth server, including revoked sessions. Never getSession.
  const { data, error } = await supabase.auth.getUser();
  if ((!data.user || error) && !isPublicPath(request.nextUrl.pathname)) {
    const redirect = NextResponse.redirect(new URL(loginDestination(request.nextUrl.pathname), request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    redirect.headers.set("Cache-Control", "private, no-store");
    return redirect;
  }
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
