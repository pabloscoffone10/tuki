import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: { signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), resetPasswordForEmail: vi.fn(), getUser: vi.fn(), updateUser: vi.fn(), signInWithOAuth: vi.fn() },
  createClient: vi.fn(), redirect: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/site-url", () => ({ getSiteUrl: () => "https://tuki.example" }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { changePassword, googleLogin, login, logout, recoverPassword, register } from "@/features/auth/actions";

const form = (values: Record<string, string>) => { const data = new FormData(); Object.entries(values).forEach(([key, value]) => data.set(key, value)); return data; };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockResolvedValue({ auth: mocks.auth });
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
});

describe("acciones de acceso", () => {
  it("no envía formularios inválidos a Supabase", async () => {
    expect((await login({}, form({ email: "incorrecto", password: "" }))).fields?.email).toBeDefined();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
  it("traduce errores y no devuelve el texto interno de Supabase", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "internal-secret" } });
    expect(await login({}, form({ email: "ana@example.com", password: "wrong" }))).toEqual({ error: "El email o la contraseña no son correctos." });
  });
  it("explica un endpoint Auth inexistente en lugar de ocultarlo", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ error: { status: 404, message: "internal gateway response" } });
    const state = await login({}, form({ email: "ana@example.com", password: "wrong" }));
    expect(state.error).toContain("URL base");
    expect(state.error).not.toContain("internal gateway response");
  });
  it("informa restricciones del SMTP durante el registro", async () => {
    mocks.auth.signUp.mockResolvedValue({ error: { code: "email_address_not_authorized", status: 400 } });
    const state = await register({}, form({ displayName: "Ana", email: "ana@example.com", password: "una clave segura", confirmPassword: "una clave segura" }));
    expect(state.error).toContain("Custom SMTP");
    expect(state.success).toBeUndefined();
  });
  it("no informa éxito si falla la limpieza de una sesión automática", async () => {
    mocks.auth.signUp.mockResolvedValue({ data: { session: {} }, error: null });
    mocks.auth.signOut.mockResolvedValue({ error: { status: 503 } });
    const state = await register({}, form({ displayName: "Ana", email: "ana@example.com", password: "una clave segura", confirmPassword: "una clave segura" }));
    expect(state.error).toBeDefined();
    expect(state.success).toBeUndefined();
  });
  it("redirige un login exitoso solo a un destino interno", async () => {
    mocks.auth.signInWithPassword.mockResolvedValue({ error: null });
    await expect(login({}, form({ email: "ana@example.com", password: "valid", next: "//evil.example" }))).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/");
    expect(mocks.revalidate).toHaveBeenCalledWith("/", "layout");
  });
  it("registra con callback y nombre, sin transmitir confirmPassword", async () => {
    mocks.auth.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const state = await register({}, form({ displayName: "Ana", email: "ana@example.com", password: "una clave segura", confirmPassword: "una clave segura" }));
    expect(state.success).toMatch(/confirmar/);
    expect(mocks.auth.signUp).toHaveBeenCalledWith({ email: "ana@example.com", password: "una clave segura", options: { data: { display_name: "Ana" }, emailRedirectTo: "https://tuki.example/auth/callback" } });
  });
  it("no deja una sesión automática si la confirmación está deshabilitada", async () => {
    mocks.auth.signUp.mockResolvedValue({ data: { session: { access_token: "fake" } }, error: null });
    mocks.auth.signOut.mockResolvedValue({ error: null });
    await register({}, form({ displayName: "Ana", email: "ana@example.com", password: "una clave segura", confirmPassword: "una clave segura" }));
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  it("envía recuperación a la pantalla de cambio sin revelar existencia de cuenta", async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({ error: null });
    const state = await recoverPassword({}, form({ email: "ana@example.com" }));
    expect(state.success).toMatch(/Si existe una cuenta/);
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith("ana@example.com", { redirectTo: "https://tuki.example/auth/callback?next=/actualizar-contrasena" });
  });
  it("no permite cambiar contraseña sin un usuario verificado", async () => {
    mocks.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    const state = await changePassword({}, form({ password: "una clave segura", confirmPassword: "una clave segura" }));
    expect(state.error).toMatch(/sesión venció/);
    expect(mocks.auth.updateUser).not.toHaveBeenCalled();
  });
  it("actualiza la contraseña de un usuario verificado", async () => {
    mocks.auth.getUser.mockResolvedValue({ data: { user: { id: "user" } }, error: null });
    mocks.auth.updateUser.mockResolvedValue({ error: null });
    expect((await changePassword({}, form({ password: "una clave segura", confirmPassword: "una clave segura" }))).success).toMatch(/actualizada/);
  });
  it("inicia Google con PKCE en el cliente SSR y callback seguro", async () => {
    mocks.auth.signInWithOAuth.mockResolvedValue({ data: { url: "https://provider.example" }, error: null });
    await expect(googleLogin({}, form({ next: "/configuracion" }))).rejects.toThrow("REDIRECT");
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: "https://tuki.example/auth/callback?next=%2Fconfiguracion", skipBrowserRedirect: true } });
  });
  it("cierra la sesión y actualiza la navegación", async () => {
    mocks.auth.signOut.mockResolvedValue({ error: null });
    await expect(logout()).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
  });
  it("maneja fallas de red sin exponer detalles", async () => {
    mocks.createClient.mockRejectedValue(new Error("private-network-details"));
    expect((await login({}, form({ email: "ana@example.com", password: "valid" }))).error).not.toContain("private-network-details");
  });
});
