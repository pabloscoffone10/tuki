// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ exchange: vi.fn(), verifyOtp: vi.fn(), createClient: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/route", () => ({ createRouteClient: mocks.createClient }));
import { GET } from "@/app/auth/callback/route";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.createClient.mockReturnValue({ rpc:mocks.rpc, auth: { exchangeCodeForSession: mocks.exchange, verifyOtp: mocks.verifyOtp } });
  mocks.exchange.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
  mocks.verifyOtp.mockResolvedValue({ data: { session: {}, user: {} }, error: null });
});

it("intercambia el código PKCE antes de entrar al destino", async () => {
  const response = await GET(new NextRequest("https://tuki.example/auth/callback?code=one-time-code&next=/actualizar-contrasena"));
  expect(mocks.exchange).toHaveBeenCalledWith("one-time-code");
  expect(response.headers.get("location")).toBe("https://tuki.example/actualizar-contrasena");
  expect(response.headers.get("cache-control")).toContain("no-store");
});
it("bloquea redirects externos", async () => {
  const response = await GET(new NextRequest("https://tuki.example/auth/callback?code=code&next=https://evil.example"));
  expect(response.headers.get("location")).toBe("https://tuki.example/");
});
it("maneja código vencido sin exponer errores del proveedor", async () => {
  mocks.exchange.mockResolvedValue({ error: { message: "sensitive-details" } });
  const response = await GET(new NextRequest("https://tuki.example/auth/callback?code=expired"));
  const location = new URL(response.headers.get("location")!);
  expect(location.pathname).toBe("/login");
  expect(location.searchParams.get("error")).toBe("callback");
  expect(location.href).not.toContain("sensitive-details");
});

it("pasa sb_flow_id al SDK para elegir el verificador correcto", async () => {
  await GET(new NextRequest("https://tuki.example/auth/callback?code=code&sb_flow_id=flow_12345678"));
  expect(mocks.exchange).toHaveBeenCalledWith("code", { flowId: "flow_12345678" });
});
it("verifica token_hash de una plantilla SSR sin exigir cookie PKCE", async () => {
  const response = await GET(new NextRequest("https://tuki.example/auth/confirm?token_hash=one-time-token&type=email"));
  expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: "one-time-token", type: "email" });
  expect(mocks.exchange).not.toHaveBeenCalled();
  expect(response.headers.get("location")).toBe("https://tuki.example/");
});
it("envía recuperación por token a cambio de contraseña", async () => {
  const response = await GET(new NextRequest("https://tuki.example/auth/confirm?token_hash=token&type=recovery&next=https://evil.example"));
  expect(response.headers.get("location")).toBe("https://tuki.example/actualizar-contrasena");
});
it.each(["token_hash=token&type=invite", "token_hash=token", "token_hash=token&type=email&code=code", "code=code&sb_flow_id=invalid!"])("rechaza formato no soportado sin consumir credenciales: %s", async (query) => {
  const response = await GET(new NextRequest(`https://tuki.example/auth/confirm?${query}`));
  expect(mocks.createClient).not.toHaveBeenCalled();
  expect(new URL(response.headers.get("location")!).searchParams.get("reason")).toBe("callback_invalid_request");
});
it("no redirige al dashboard si el SDK no devuelve una sesión", async () => {
  mocks.exchange.mockResolvedValue({ data: { session: null, user: null }, error: null });
  const response = await GET(new NextRequest("https://tuki.example/auth/callback?code=code"));
  expect(new URL(response.headers.get("location")!).searchParams.get("reason")).toBe("callback_session_missing");
});
it("explica el verificador ausente sin afirmar que el correo no se verificó", async () => {
  mocks.exchange.mockResolvedValue({ error: { name: "AuthPKCECodeVerifierMissingError" } });
  const response = await GET(new NextRequest("https://tuki.example/auth/callback?code=private-code"));
  const location = new URL(response.headers.get("location")!);
  expect(location.searchParams.get("reason")).toBe("pkce_verifier_missing");
  expect(location.href).not.toContain("private-code");
});
it("no intercambia códigos si el proveedor devuelve error o falta el código", async () => {
  await GET(new NextRequest("https://tuki.example/auth/callback?error=access_denied&error_description=private"));
  await GET(new NextRequest("https://tuki.example/auth/callback"));
  expect(mocks.exchange).not.toHaveBeenCalled();
});

it.each(["code=oauth-code", "token_hash=email-token&type=email"])("offers optional bank setup once after verified email or OAuth: %s",async query=>{
 const auth={data:{session:{},user:{email_confirmed_at:"2026-11-04T12:00:00Z"}},error:null};mocks.exchange.mockResolvedValue(auth);mocks.verifyOtp.mockResolvedValue(auth);mocks.rpc.mockResolvedValue({data:true,error:null});
 const response=await GET(new NextRequest(`https://tuki.example/auth/callback?${query}&next=/grupos`));
 expect(mocks.rpc).toHaveBeenCalledWith("tuki_offer_payment_onboarding");expect(new URL(response.headers.get("location")!).pathname).toBe("/bienvenida-pagos");expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/grupos");
});
it.each([{data:false,error:null},{data:null,error:{code:"PGRST202"}}])("preserves login destination for existing users or unavailable optional migration",async result=>{
 mocks.exchange.mockResolvedValue({data:{session:{},user:{email_confirmed_at:"2026-11-04"}},error:null});mocks.rpc.mockResolvedValue(result);
 const response=await GET(new NextRequest("https://tuki.example/auth/callback?code=code&next=/balances"));expect(response.headers.get("location")).toBe("https://tuki.example/balances");
});
it("never interrupts password recovery with payment onboarding",async()=>{
 mocks.verifyOtp.mockResolvedValue({data:{session:{},user:{email_confirmed_at:"2026-11-04"}},error:null});
 const response=await GET(new NextRequest("https://tuki.example/auth/confirm?token_hash=token&type=recovery"));expect(mocks.rpc).not.toHaveBeenCalled();expect(response.headers.get("location")).toBe("https://tuki.example/actualizar-contrasena");
});
