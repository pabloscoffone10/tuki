// @vitest-environment node
import { beforeEach,it,expect,vi } from "vitest";
const mocks=vi.hoisted(()=>({requireUser:vi.fn(),client:vi.fn(),rpc:vi.fn(),redirect:vi.fn(),revalidate:vi.fn()}));
vi.mock("@/features/auth/session",()=>({requireUser:mocks.requireUser}));
vi.mock("@/lib/supabase/server",()=>({createClient:mocks.client}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidate}));
import { finishPaymentOnboarding } from "@/features/auth/onboarding-actions";
const form=(next="/grupos")=>{const f=new FormData();f.set("next",next);return f;};
beforeEach(()=>{vi.resetAllMocks();mocks.requireUser.mockResolvedValue({id:"current-user"});mocks.client.mockResolvedValue({rpc:mocks.rpc});mocks.rpc.mockResolvedValue({error:null});mocks.redirect.mockImplementation(()=>{throw new Error("REDIRECT");});});
it("persists completion for the authenticated user before continuing to the original destination",async()=>{await expect(finishPaymentOnboarding({},form())).rejects.toThrow("REDIRECT");expect(mocks.requireUser).toHaveBeenCalledTimes(1);expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("tuki_finish_payment_onboarding");expect(mocks.revalidate).toHaveBeenCalledWith("/","layout");expect(mocks.redirect).toHaveBeenCalledWith("/grupos");expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.redirect.mock.invocationCallOrder[0]);});
it.each(["https://evil.example","//evil.example","/bienvenida-pagos","/grupos/../login"])("sanitizes the completion return destination: %s",async next=>{await expect(finishPaymentOnboarding({},form(next))).rejects.toThrow("REDIRECT");expect(mocks.redirect).toHaveBeenCalledWith("/");});
it("does not write a completion or accept a forged user id without an authenticated session",async()=>{mocks.requireUser.mockRejectedValue(new Error("LOGIN"));const f=form();f.set("user_id","another-user");await expect(finishPaymentOnboarding({},f)).rejects.toThrow("LOGIN");expect(mocks.client).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();});
it.each(["database","network"])("keeps the form available when persisting the decision fails: %s",async failure=>{if(failure==="database")mocks.rpc.mockResolvedValue({error:{message:"private-db-details"}});else mocks.rpc.mockRejectedValue(new Error("private-network-details"));const result=await finishPaymentOnboarding({},form());expect(result.error).toBeTruthy();expect(result.error).not.toMatch(/private-/);expect(mocks.redirect).not.toHaveBeenCalled();expect(mocks.revalidate).not.toHaveBeenCalled();});
