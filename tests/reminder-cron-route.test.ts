// @vitest-environment node
import { afterEach,beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({rpc:vi.fn(),client:vi.fn()}));
vi.mock("@supabase/supabase-js",()=>({createClient:mocks.client}));
import { POST } from "@/app/api/internal/reminders/route";
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("TUKI_AUTOMATIC_REMINDERS_ENABLED","false");vi.stubEnv("TUKI_CRON_SECRET","x".repeat(32));vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://example.supabase.co");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","test-only-never-real");mocks.client.mockReturnValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({data:2,error:null});});
afterEach(()=>vi.unstubAllEnvs());
it("is disabled by default and requires its own strong secret",async()=>{expect((await POST(new Request("http://localhost",{method:"POST"}))).status).toBe(503);vi.stubEnv("TUKI_AUTOMATIC_REMINDERS_ENABLED","true");expect((await POST(new Request("http://localhost",{method:"POST"}))).status).toBe(401);expect(mocks.client).not.toHaveBeenCalled();});
it("runs only the scheduled RPC without exposing the server key",async()=>{vi.stubEnv("TUKI_AUTOMATIC_REMINDERS_ENABLED","true");const response=await POST(new Request("http://localhost",{method:"POST",headers:{authorization:`Bearer ${"x".repeat(32)}`}}));expect(await response.json()).toEqual({queued:2});expect(mocks.rpc).toHaveBeenCalledWith("tuki_run_automatic_reminders");});
