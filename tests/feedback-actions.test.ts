// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null }, error: null }) } }) }));
import { submitFeedback } from "@/features/feedback/actions";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("identifies missing server configuration without exposing credentials", async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const form = new FormData();
  for (const [name, value] of Object.entries({ category: "sugerencia", description: "Una idea", email: "", website: "" })) form.set(name, value);
  const result = await submitFeedback({ ok: false, message: "" }, form);
  expect(result.ok).toBe(false);
  expect(result.message).toContain("configuración en el servidor");
  expect(log).toHaveBeenCalledWith("feedback_not_configured");
});
