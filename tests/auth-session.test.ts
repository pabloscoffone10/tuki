import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), redirect: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createReadOnlyClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
import { requireUser } from "@/features/auth/session";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error("REDIRECT"); });
});
it("la protección del servidor rechaza usuarios sin verificar independientemente del proxy", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  await expect(requireUser()).rejects.toThrow("REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/login");
});
it("devuelve únicamente el usuario verificado por Auth", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: "verified" } }, error: null });
  expect(await requireUser()).toEqual({ id: "verified" });
});
