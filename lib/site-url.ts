import "server-only";
import { AuthConfigurationError } from "./configuration-error";

export function getSiteUrl() {
  const configured = process.env.TUKI_SITE_URL;
  if (!configured && process.env.NODE_ENV === "production") throw new AuthConfigurationError("configuration_site_url");
  let url: URL;
  try { url = new URL(configured || "http://localhost:3000"); }
  catch { throw new AuthConfigurationError("configuration_site_url"); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
      !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new AuthConfigurationError("configuration_site_url");
  }
  return url.origin;
}
