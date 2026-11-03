// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
vi.mock("@/lib/env", () => ({ requireSupabaseConfig: () => ({ url: "https://project.example", publishableKey: "public-test-key" }) }));
import { createRouteClient } from "@/lib/supabase/route";
import { GET } from "@/app/auth/callback/route";

const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", email: "test@example.com" };
function sessionResponse() {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  // Large, fake JWT forces cookie chunking. No real credentials or requests.
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, padding: "x".repeat(4500) })}.fake-signature`;
  return new Response(JSON.stringify({ access_token: token, refresh_token: "fake-refresh", token_type: "bearer", expires_in: 3600, user }), { status: 200, headers: { "Content-Type": "application/json" } });
}
afterEach(() => vi.unstubAllGlobals());

it("el SDK real verifica el hash y deja los chunks de sesión en el redirect", async () => {
  const network = vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toContain("/auth/v1/verify");
    return sessionResponse();
  });
  vi.stubGlobal("fetch", network);
  const response = await GET(new NextRequest("https://tuki.example/auth/confirm?token_hash=fake-one-time-hash&type=email"));
  expect(response.headers.get("location")).toBe("https://tuki.example/");
  expect(network).toHaveBeenCalledTimes(1);
  expect(String(network.mock.calls[0]?.[0])).toContain("/auth/v1/verify");
  const chunks = response.cookies.getAll().filter((cookie) => cookie.name.includes("auth-token."));
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((cookie) => cookie.path === "/" && cookie.sameSite === "lax")).toBe(true);
});

it.each([false, true])("el SDK real conserva el verificador de registro (flow id explícito: %s)", async (explicitFlow) => {
  let redirectTo = "";
  let verifierSent = false;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/signup")) {
      redirectTo = url.searchParams.get("redirect_to") || "";
      return new Response(JSON.stringify({ user, session: null }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.pathname.endsWith("/token") && url.searchParams.get("grant_type") === "pkce") {
      const body = JSON.parse(String(init?.body));
      verifierSent = typeof body.code_verifier === "string" && body.code_verifier.length > 0;
      return sessionResponse();
    }
    throw new Error("Unexpected request in isolated test");
  }));
  const signupRequest = new NextRequest("https://tuki.example/registro");
  const signupResponse = NextResponse.next();
  const client = createRouteClient(signupRequest, signupResponse);
  const signup = await client.auth.signUp({ email: "test@example.com", password: "fake-test-password", options: { emailRedirectTo: "https://tuki.example/auth/callback" } });
  expect(signup.error).toBeNull();
  expect(new URL(redirectTo).pathname).toBe("/auth/callback");
  const flowId = signupResponse.cookies.getAll().map((cookie) => cookie.name.match(/-flow-([A-Za-z0-9_-]{8,64})-code-verifier(?:\.\d+)?$/)?.[1]).find(Boolean);
  expect(flowId).toBeTruthy();
  expect(signupResponse.cookies.getAll().some((cookie) => cookie.name.includes("code-verifier"))).toBe(true);
  const callback = new URL("https://tuki.example/auth/callback?code=fake-auth-code");
  if (explicitFlow) callback.searchParams.set("sb_flow_id", flowId!);
  const cookies = signupResponse.cookies.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  const response = await GET(new NextRequest(callback, { headers: { cookie: cookies } }));
  expect(verifierSent).toBe(true);
  expect(response.headers.get("location")).toBe("https://tuki.example/");
  expect(response.cookies.getAll().some((cookie) => cookie.name.includes("auth-token."))).toBe(true);
});
