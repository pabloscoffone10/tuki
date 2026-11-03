import { AuthConfigurationError } from "@/lib/configuration-error";
import type { AuthState } from "./schemas";

export function authError(code?: string) {
  switch (code) {
    case "invalid_credentials": return "El email o la contraseña no son correctos.";
    case "email_not_confirmed": return "Confirmá tu email antes de iniciar sesión. Revisá también la carpeta de spam.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit": return "Hubo demasiados intentos. Esperá unos minutos y volvé a intentar.";
    case "weak_password": return "La contraseña no cumple los requisitos de seguridad. Probá una más larga y variada.";
    case "same_password": return "Elegí una contraseña distinta de la actual.";
    case "configuration_supabase": return "La configuración de Supabase no es válida. Revisá NEXT_PUBLIC_SUPABASE_URL (URL base, sin /rest/v1 ni /auth/v1) y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Reiniciá el servidor después de corregirlas.";
    case "configuration_site_url": return "Configurá TUKI_SITE_URL con el origen de Tuki (HTTPS en producción, HTTP solo en localhost) y reiniciá el servidor.";
    case "auth_endpoint_not_found": return "Supabase no encontró el endpoint de autenticación. Revisá que NEXT_PUBLIC_SUPABASE_URL sea la URL base del proyecto, sin /rest/v1 ni /auth/v1.";
    case "invalid_api_key": return "Supabase rechazó la clave pública. Verificá que la URL y la publishable key pertenezcan al mismo proyecto.";
    case "email_address_not_authorized": return "Supabase no permite enviar correos a ese destinatario con su servicio de email actual. Configurá Custom SMTP para registrar usuarios fuera de los destinatarios autorizados.";
    case "email_address_invalid": return "El servicio de correo rechazó ese email. Revisá la dirección o probá con otra dirección propia válida.";
    case "signup_disabled": return "Los registros están deshabilitados en Supabase. Habilitá nuevos registros manteniendo activa la confirmación de email.";
    case "email_provider_disabled": return "El acceso por email está deshabilitado en Supabase. Habilitá el proveedor Email.";
    case "provider_disabled": return "El proveedor de acceso no está habilitado en Supabase. Revisá la configuración de Google.";
    case "unexpected_failure": return "Supabase informó un fallo interno. Revisá Auth Logs y los errores PostgreSQL del mismo intento para distinguir un problema de trigger, base de datos o envío de correo. No desactives RLS.";
    case "database_failure": return "Supabase no pudo completar la operación en su base de datos. Revisá Auth Logs y los errores PostgreSQL del mismo intento; un trigger de perfil puede ser la causa. No desactives RLS.";
    case "email_delivery_failed": return "Falló el envío del correo. Revisá Auth Logs y la configuración SMTP en Supabase; mantené activa la confirmación de email.";
    case "bad_code_verifier":
    case "pkce_verifier_missing":
    case "pkce_verifier_mismatch":
    case "flow_state_not_found":
    case "flow_state_expired": return "No pudimos abrir la sesión: el enlace venció o falta la cookie PKCE de este navegador. Esto no significa que haya fallado la verificación del correo. Si ya figura verificado, iniciá sesión con email y contraseña. Para un nuevo enlace PKCE, usá el mismo navegador y origen donde lo pediste.";
    case "otp_expired": return "El enlace venció o ya fue utilizado. Solicitá uno nuevo.";
    case "callback_missing_credentials": return "El enlace llegó sin código ni token de confirmación. Si tu correo ya figura verificado, iniciá sesión con email y contraseña. Para nuevos correos, revisá la plantilla y las Redirect URLs de Supabase.";
    case "callback_invalid_request": return "El formato del enlace no es compatible. Revisá la plantilla de confirmación de Supabase y solicitá un enlace nuevo; no pegues tokens manualmente.";
    case "callback_session_missing": return "No se recibió una sesión después de confirmar el enlace. Si tu correo ya quedó verificado, podés iniciar sesión con email y contraseña.";
    case "callback_provider_error": return "El proveedor no completó la confirmación. Si el correo ya está verificado, iniciá sesión; si no, solicitá un enlace nuevo.";
    case "network_failure": return "No pudimos conectar con Supabase. Revisá la conexión y volvé a intentar.";
    default: return "No pudimos completar la operación. Volvé a intentar. Si continúa, revisá la configuración de autenticación.";
  }
}

const allowedCodes = new Set([
  "pkce_verifier_missing", "pkce_verifier_mismatch", "callback_missing_credentials", "callback_invalid_request", "callback_session_missing", "callback_provider_error",
  "invalid_credentials", "email_not_confirmed", "over_email_send_rate_limit", "over_request_rate_limit", "weak_password", "same_password",
  "configuration_supabase", "configuration_site_url", "auth_endpoint_not_found", "invalid_api_key", "email_address_not_authorized",
  "email_address_invalid", "signup_disabled", "email_provider_disabled", "provider_disabled", "unexpected_failure", "database_failure",
  "email_delivery_failed", "bad_code_verifier", "flow_state_not_found", "flow_state_expired", "otp_expired", "network_failure",
]);

export function safeAuthCode(error: unknown): string {
  if (error instanceof AuthConfigurationError) return error.code;
  if (!error || typeof error !== "object") return "unknown_auth_error";
  const value = error as { code?: unknown; status?: unknown; message?: unknown; name?: unknown };
  if (typeof value.code === "string" && value.code !== "unexpected_failure" && allowedCodes.has(value.code)) return value.code;
  // Classify known gateway/SDK failures without exposing their raw messages.
  const message = typeof value.message === "string" ? value.message : "";
  if (value.name === "AuthPKCECodeVerifierMissingError" || /code verifier.*(empty|missing)|both auth code and code verifier/i.test(message)) return "pkce_verifier_missing";
  if (value.status === 404) return "auth_endpoint_not_found";
  if (/invalid api key/i.test(message)) return "invalid_api_key";
  if (/database error (saving|creating|updating)/i.test(message)) return "database_failure";
  if (/error sending (confirmation|recovery|reset)/i.test(message)) return "email_delivery_failed";
  if (value.name === "AuthRetryableFetchError" || /fetch failed|network error/i.test(message)) return "network_failure";
  if (value.code === "unexpected_failure") return "unexpected_failure";
  return "unknown_auth_error";
}

export type AuthOperation = "login" | "register" | "recovery" | "password" | "google" | "logout" | "callback";
export function authFailure(operation: AuthOperation, error: unknown): AuthState {
  const code = safeAuthCode(error);
  const statusValue = error && typeof error === "object" ? (error as { status?: unknown }).status : undefined;
  const status = typeof statusValue === "number" && Number.isInteger(statusValue) && statusValue >= 400 && statusValue <= 599 ? statusValue : undefined;
  const development = process.env.NODE_ENV === "development";
  // Fixed metadata only: never log error objects, messages, form data or URLs.
  if (development) console.warn("[Tuki Auth]", { operation, code, ...(status ? { status } : {}) });
  const diagnostic = development ? ` [operación: ${operation}; código: ${code}${status ? `; HTTP ${status}` : ""}]` : "";
  return { error: authError(code) + diagnostic };
}

export function callbackDiagnostic(code: unknown): string | undefined {
  return process.env.NODE_ENV === "development" && typeof code === "string" && allowedCodes.has(code) ? authError(code) : undefined;
}

export function callbackReason(code: unknown): string | undefined {
  const reasons = ["pkce_verifier_missing", "pkce_verifier_mismatch", "bad_code_verifier", "flow_state_not_found", "flow_state_expired", "otp_expired", "callback_missing_credentials", "callback_invalid_request", "callback_session_missing", "callback_provider_error"];
  return typeof code === "string" && reasons.includes(code) ? authError(code) : undefined;
}
