import { beforeEach, expect, it, vi } from "vitest";
import type { CookieMethodsServer } from "@supabase/ssr";
const mocks = vi.hoisted(() => ({ getAll: vi.fn(), set: vi.fn(), createServerClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: mocks.getAll, set: mocks.set }) }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/env", () => ({ requireSupabaseConfig: () => ({ url: "https://project.example", publishableKey: "test-public-key" }) }));
import { createClient, createReadOnlyClient } from "@/lib/supabase/server";

beforeEach(() => vi.resetAllMocks());
it("el cliente de acciones guarda todas las cookies SSR y el verificador PKCE", async () => {
  await createClient();
  const config = mocks.createServerClient.mock.calls[0][2] as { auth: { flowType: string }; cookies: CookieMethodsServer };
  expect(config.auth.flowType).toBe("pkce");
  await config.cookies.setAll!([
    { name: "sb-test-code-verifier", value: "verifier", options: { path: "/", sameSite: "lax" } },
    { name: "sb-test-auth-token.0", value: "session-chunk", options: { path: "/", secure: true } },
  ], {});
  expect(mocks.set).toHaveBeenCalledTimes(2);
  expect(mocks.set).toHaveBeenCalledWith("sb-test-code-verifier", "verifier", { path: "/", sameSite: "lax" });
});
it("el cliente de componentes no intenta escribir cookies y no se comparte entre requests", async () => {
  await createReadOnlyClient();
  await createReadOnlyClient();
  expect(mocks.createServerClient).toHaveBeenCalledTimes(2);
  const config = mocks.createServerClient.mock.calls[0][2] as { cookies: CookieMethodsServer };
  expect(config.cookies.setAll).toBeUndefined();
});
