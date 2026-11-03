import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { getSiteUrl } from "@/lib/site-url";
afterEach(() => vi.unstubAllEnvs());
it("exige origen explícito en producción", () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TUKI_SITE_URL", "");
  expect(getSiteUrl).toThrow("configuration_site_url");
});
it("permite localhost para desarrollo y HTTPS en producción", () => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("TUKI_SITE_URL", "");
  expect(getSiteUrl()).toBe("http://localhost:3000");
  vi.stubEnv("TUKI_SITE_URL", "https://tuki.example/");
  expect(getSiteUrl()).toBe("https://tuki.example");
});
it.each(["http://external.example", "https://user:password@tuki.example", "https://tuki.example/login", "https://tuki.example?next=evil"])("rechaza origen inseguro %s", (origin) => {
  vi.stubEnv("TUKI_SITE_URL", origin);
  expect(getSiteUrl).toThrow();
});
