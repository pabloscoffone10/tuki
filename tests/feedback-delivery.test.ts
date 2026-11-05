// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
import { deliverFeedback } from "@/features/feedback/server";
beforeEach(() => {
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://example.supabase.co"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","secret");
 vi.stubEnv("RESEND_API_KEY","provider-secret"); vi.stubEnv("TUKI_FEEDBACK_FROM","Tuki <help@example.com>"); vi.stubEnv("TUKI_FEEDBACK_TO","owner@example.com");
 mocks.rpc.mockReset(); mocks.rpc.mockResolvedValue({error:null});
 mocks.rpc.mockResolvedValueOnce({ data:[{id:"report",lease:"lease",category:"error",description:"<script>private</script>",user_id:null,email:null}],error:null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("records delivery failure without deleting the report", async () => {
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue({ok:false,status:500}));
 await deliverFeedback("report");
 expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_finish_feedback",{p_id:"report",p_lease:"lease",p_error:"email_http_500"});
});
it("retains reports if the email provider is not configured", async () => {
 vi.stubEnv("RESEND_API_KEY",""); const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
 await deliverFeedback("report");expect(fetcher).not.toHaveBeenCalled();
 expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_finish_feedback",{p_id:"report",p_lease:"lease",p_error:"email_not_configured"});
});
it("sends plain text with an idempotency key and acknowledges success", async () => {
 const fetcher=vi.fn().mockResolvedValue({ok:true});vi.stubGlobal("fetch",fetcher);
 await deliverFeedback("report");
 const options=fetcher.mock.calls[0][1]; expect(options.headers["Idempotency-Key"]).toBe("feedback/report");
 const body=JSON.parse(options.body);expect(body.html).toBeUndefined();expect(body.text).toContain("<script>private</script>");
 expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_finish_feedback",{p_id:"report",p_lease:"lease",p_error:null});
});
