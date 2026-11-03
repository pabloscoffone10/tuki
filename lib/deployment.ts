import { isPublicSupabaseKey } from "./public-supabase-key";
/** Build/start configuration only. Do not import this module into a browser bundle. */
type DeploymentEnvironment = {
  [name: string]: string | undefined;
  VERCEL_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  TUKI_SITE_URL?: string;
  TUKI_STAGING_SUPABASE_ORIGIN?: string;
  TUKI_PRODUCTION_SUPABASE_ORIGIN?: string;
};

function httpsOrigin(value: string | undefined, field: keyof DeploymentEnvironment): string {
  let parsed: URL;
  try { parsed = new URL(value ?? ""); }
  catch { throw Error(`deployment_configuration: ${field} debe contener un origen HTTPS válido.`); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
    || ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
    throw Error(`deployment_configuration: ${field} debe contener solo un origen HTTPS remoto, sin rutas ni credenciales.`);
  }
  return parsed.origin;
}

/**
 * Owner-configured allowlist, not discovery from a request Host header.
 * Fail closed on Vercel preview/production; leave ordinary local development alone.
 * URL values, keys and secrets must never be included in the error messages.
 */
export function validateDeploymentEnvironment(environment: DeploymentEnvironment): void {
  if (environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY !== undefined
    && !isPublicSupabaseKey(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    throw Error("deployment_configuration: NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY debe ser una clave pública; nunca una clave secreta o service_role.");
  }
  const stage = environment.VERCEL_ENV;
  if (stage !== "preview" && stage !== "production") return;
  const production = httpsOrigin(environment.TUKI_PRODUCTION_SUPABASE_ORIGIN, "TUKI_PRODUCTION_SUPABASE_ORIGIN");
  const actual = httpsOrigin(environment.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  httpsOrigin(environment.TUKI_SITE_URL, "TUKI_SITE_URL");

  if (stage === "preview") {
    const staging = httpsOrigin(environment.TUKI_STAGING_SUPABASE_ORIGIN, "TUKI_STAGING_SUPABASE_ORIGIN");
    if (staging === production) throw Error("deployment_configuration: staging y producción deben usar orígenes Supabase distintos.");
    if (actual !== staging) throw Error("deployment_configuration: Preview requiere NEXT_PUBLIC_SUPABASE_URL igual a TUKI_STAGING_SUPABASE_ORIGIN.");
  } else {
    if (actual !== production) throw Error("deployment_configuration: Production requiere NEXT_PUBLIC_SUPABASE_URL igual a TUKI_PRODUCTION_SUPABASE_ORIGIN.");
    if (environment.TUKI_STAGING_SUPABASE_ORIGIN
      && httpsOrigin(environment.TUKI_STAGING_SUPABASE_ORIGIN, "TUKI_STAGING_SUPABASE_ORIGIN") === production) {
      throw Error("deployment_configuration: staging y producción deben usar orígenes Supabase distintos.");
    }
  }
}
