import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createRouteClient } from "@/lib/supabase/route";
import { authFailure, safeAuthCode } from "./errors";
import { safeNext } from "./redirects";

function privateRedirect(path: string, request: NextRequest) {
  const response = NextResponse.redirect(new URL(path, request.url));
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

export async function handleAuthCallback(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  const tokenHash = params.get("token_hash");
  const type = params.get("type");
  const flowId = params.get("sb_flow_id");
  const destination = type === "recovery" ? "/actualizar-contrasena" : safeNext(params.get("next"));
  const response = privateRedirect(destination, request);
  let failure: unknown = { code: "callback_missing_credentials" };

  if (params.has("error")) {
    failure = { code: params.get("error_code") || "callback_provider_error" };
  } else if ((code && tokenHash) || (flowId && !/^[A-Za-z0-9_-]{8,64}$/.test(flowId)) ||
    (tokenHash && !["email", "signup", "recovery"].includes(type || ""))) {
    failure = { code: "callback_invalid_request" };
  } else if (code || tokenHash) {
    try {
      const supabase = createRouteClient(request, response);
      // token_hash is a signed one-time email credential, verified by Auth.
      // OAuth and ConfirmationURL callbacks retain the PKCE code flow.
      const result = code
        ? await supabase.auth.exchangeCodeForSession(code, ...(flowId ? [{ flowId }] : []))
        : await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: type as "email" | "signup" | "recovery" });
      failure = result.error;
      if (!result.error && result.data.session && result.data.user) return response;
      if (!result.error) failure = { code: "callback_session_missing" };
    } catch (error) { failure = error; }
  }

  authFailure("callback", failure);
  const login = new URL("/login?error=callback", request.url);
  const reason = safeAuthCode(failure);
  login.searchParams.set("reason", reason);
  if (process.env.NODE_ENV === "development") login.searchParams.set("diagnostic", reason);
  const rejected = privateRedirect(login.pathname + login.search, request);
  // Preserve SDK cookie cleanup, but never forward credential query parameters.
  response.cookies.getAll().forEach((cookie) => rejected.cookies.set(cookie));
  return rejected;
}
