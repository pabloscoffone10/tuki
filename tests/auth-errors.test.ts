import { afterEach, describe, expect, it, vi } from "vitest";
import { authError, authFailure, callbackDiagnostic, safeAuthCode } from "@/features/auth/errors";
import { AuthConfigurationError } from "@/lib/configuration-error";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("diagnósticos seguros", () => {
  it("identifica el 404 que causaba el mensaje genérico", () => {
    expect(safeAuthCode({ status: 404, message: "raw gateway response" })).toBe("auth_endpoint_not_found");
    expect(authError("auth_endpoint_not_found")).toContain("sin /rest/v1");
  });
  it("distingue restricciones de correo, fallas de trigger y de configuración", () => {
    expect(authError("email_address_not_authorized")).toContain("Custom SMTP");
    expect(authError("unexpected_failure")).toContain("Auth Logs");
    expect(safeAuthCode(new AuthConfigurationError("configuration_supabase"))).toBe("configuration_supabase");
    expect(safeAuthCode({ status: 401, message: "Invalid API key" })).toBe("invalid_api_key");
    expect(safeAuthCode({ code: "unexpected_failure", message: "Error sending confirmation email" })).toBe("email_delivery_failed");
    expect(safeAuthCode({ code: "unexpected_failure", message: "Database error saving new user" })).toBe("database_failure");
  });
  it("solo registra operación, código permitido y estado numérico en desarrollo", () => {
    vi.stubEnv("NODE_ENV", "development");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = authFailure("register", { code: "untrusted-secret-code", status: 404, message: "password=private token=private", email: "private@example.com", stack: "private-stack" });
    expect(response.error).toContain("operación: register; código: auth_endpoint_not_found; HTTP 404");
    expect(log).toHaveBeenCalledWith("[Tuki Auth]", { operation: "register", code: "auth_endpoint_not_found", status: 404 });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private");
    expect(response.error).not.toContain("private");
  });
  it("no imprime diagnósticos ni mensajes originales en producción", () => {
    vi.stubEnv("NODE_ENV", "production");
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(authFailure("login", { status: 404, message: "private" }).error).not.toContain("HTTP");
    expect(log).not.toHaveBeenCalled();
    expect(callbackDiagnostic("auth_endpoint_not_found")).toBeUndefined();
  });
  it("no admite texto libre en el diagnóstico del callback", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(callbackDiagnostic("token=private")).toBeUndefined();
    expect(callbackDiagnostic("flow_state_expired")).toContain("PKCE");
  });
});
