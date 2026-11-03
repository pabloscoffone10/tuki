export class AuthConfigurationError extends Error {
  constructor(public readonly code: "configuration_supabase" | "configuration_site_url") {
    super(code);
    this.name = "AuthConfigurationError";
  }
}
