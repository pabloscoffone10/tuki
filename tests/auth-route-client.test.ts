// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({ createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/env", () => ({ requireSupabaseConfig: () => ({ url: "https://project.example", publishableKey: "public-test" }) }));
import { createRouteClient } from "@/lib/supabase/route";
beforeEach(() => vi.resetAllMocks());
it("escribe chunks de sesión y elimina cookies en la respuesta de redirección real", async () => {
  const request = new NextRequest("https://tuki.example/auth/callback", { headers: { cookie: "old=old-value" } });
  const response = NextResponse.redirect("https://tuki.example/");
  createRouteClient(request, response);
  const options = mocks.createServerClient.mock.calls[0][2] as { cookies: CookieMethodsServer };
  await options.cookies.setAll!([
    { name: "sb-test-auth-token.0", value: "first-chunk", options: { path: "/", secure: true, sameSite: "lax" } },
    { name: "sb-test-auth-token.1", value: "second-chunk", options: { path: "/", secure: true } },
    { name: "old", value: "", options: { path: "/", maxAge: 0 } },
  ], { "Cache-Control": "private, no-store" });
  expect(response.status).toBe(307);
  expect(response.cookies.get("sb-test-auth-token.0")).toMatchObject({ value: "first-chunk", secure: true, sameSite: "lax", path: "/" });
  expect(response.cookies.get("sb-test-auth-token.1")?.value).toBe("second-chunk");
  expect(response.cookies.get("old")?.maxAge).toBe(0);
  expect(request.cookies.get("sb-test-auth-token.0")?.value).toBe("first-chunk");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
