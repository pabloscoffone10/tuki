// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { CookieMethodsServer } from "@supabase/ssr";

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), createServerClient: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/env", () => ({ requireSupabaseConfig: () => ({ url: "https://project.example", publishableKey: "test-public-key" }) }));
import { updateSession } from "@/lib/supabase/proxy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
});

describe("proxy de autenticación", () => {
  it.each(["/", "/grupos", "/balances", "/pagos", "/actividad", "/configuracion", "/ayuda", "/actualizar-contrasena", "/grupos/privado"])("protege %s sin sesión", async (path) => {
    const response = await updateSession(new NextRequest(`https://tuki.example${path}`));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each(["/login", "/registro", "/recuperar-contrasena", "/auth/callback"])("permite %s sin sesión", async (path) => {
    const response = await updateSession(new NextRequest(`https://tuki.example${path}`));
    expect(response.status).toBe(200);
  });
  it("rechaza cookies de sesión cuando Auth no valida al usuario", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: "invalid JWT" } });
    const response = await updateSession(new NextRequest("https://tuki.example/grupos", { headers: { cookie: "sb-fake-auth-token=forged" } }));
    expect(response.status).toBe(307);
  });
  it.each(["/auth/callback", "/auth/confirm"])("no renueva una sesión anterior antes del intercambio en %s", async (path) => {
    const response = await updateSession(new NextRequest(`https://tuki.example${path}`));
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it("propaga cookies renovadas al request y response sin perder atributos", async () => {
    mocks.getUser.mockImplementation(async () => {
      const options = mocks.createServerClient.mock.calls[0][2] as { cookies: CookieMethodsServer };
      await options.cookies.setAll!([{ name: "sb-test-auth-token", value: "renewed", options: { path: "/", sameSite: "lax", secure: true } }], { "Cache-Control": "private, no-store" });
      return { data: { user: { id: "verified" } }, error: null };
    });
    const request = new NextRequest("https://tuki.example/grupos");
    const response = await updateSession(request);
    expect(response.status).toBe(200);
    expect(request.cookies.get("sb-test-auth-token")?.value).toBe("renewed");
    expect(response.cookies.get("sb-test-auth-token")).toMatchObject({ value: "renewed", secure: true, sameSite: "lax" });
  });
  it("conserva cookies eliminadas al redirigir una sesión inválida", async () => {
    mocks.getUser.mockImplementation(async () => {
      const options = mocks.createServerClient.mock.calls[0][2] as { cookies: CookieMethodsServer };
      await options.cookies.setAll!([{ name: "expired", value: "", options: { path: "/", maxAge: 0 } }], {});
      return { data: { user: null }, error: null };
    });
    const response = await updateSession(new NextRequest("https://tuki.example/configuracion"));
    expect(response.status).toBe(307);
    expect(response.cookies.get("expired")?.maxAge).toBe(0);
  });
});
