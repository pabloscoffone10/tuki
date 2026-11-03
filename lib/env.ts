import { z } from "zod";
import { AuthConfigurationError } from "./configuration-error";
import { isPublicSupabaseKey } from "./public-supabase-key";

const publicSupabaseSchema = z.object({
  url: z.url().refine((value) => {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) && url.pathname === "/" && !url.search && !url.hash && !url.username && !url.password;
    } catch { return false; }
  }, "Usá la URL base del proyecto, sin /rest/v1, /auth/v1, parámetros ni credenciales."),
  publishableKey: z.string().trim().min(1).refine(isPublicSupabaseKey, "Usá una publishable key o una clave anon heredada, nunca una clave secreta o service_role."),
});
type PublicEnvironment = { NEXT_PUBLIC_SUPABASE_URL?: string; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string };

// Validate lazily. Auth entry points require complete public configuration.
export function readSupabaseConfig(environment: PublicEnvironment) {
  const result = publicSupabaseSchema.safeParse({ url: environment.NEXT_PUBLIC_SUPABASE_URL, publishableKey: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
  return result.success ? result.data : null;
}
export function requireSupabaseConfig() {
  const config = readSupabaseConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!config) throw new AuthConfigurationError("configuration_supabase");
  return config;
}
