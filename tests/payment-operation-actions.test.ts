// @vitest-environment node
import { beforeEach,afterEach,it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({user:vi.fn(),rpc:vi.fn(),refresh:vi.fn()}));
vi.mock("@/features/auth/session",()=>({requireUser:mocks.user}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:mocks.rpc})}));
vi.mock("next/cache",()=>({revalidatePath:mocks.refresh}));
import { prepareAndSubmitPayment } from "@/features/payments/operation-server";
import { recoverPaymentOperation,resumePaymentOperation,resolvePaymentOperation } from "@/features/payments/operation-actions";
const id="00000000-0000-4000-8000-000000000001",old="00000000-0000-4000-8000-000000000002";
beforeEach(()=>{vi.resetAllMocks();vi.spyOn(console,"warn").mockImplementation(()=>{});mocks.user.mockResolvedValue({id:"actor"});mocks.rpc.mockResolvedValue({data:null,error:null});});
afterEach(()=>{vi.restoreAllMocks();});
it("a lost submit response is unknown; recovery queries the original ID without sending a new payment",async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{operation_protocol:true}}).mockResolvedValueOnce({data:{id,state:"prepared"}}).mockRejectedValueOnce(Error("private token"));
 expect(await prepareAndSubmitPayment(id,{amount:"300",note:"private note"})).toMatchObject({unknown:true});
 expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toMatch(/private token|private note|300/);
 mocks.rpc.mockResolvedValueOnce({data:{id,state:"processed",payment_status:"confirmed"}});expect((await recoverPaymentOperation(id)).operation?.id).toBe(id);expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_payment_operation",{p_id:id});expect(mocks.rpc.mock.calls.filter(([name])=>name==="tuki_submit_prepared_payment")).toHaveLength(1);
});
it("another unfinished request is recovered rather than automatically submitted or replaced",async()=>{
 mocks.rpc.mockResolvedValueOnce({data:{operation_protocol:true}}).mockResolvedValueOnce({error:{message:"operation_unresolved"}}).mockResolvedValueOnce({data:{id:old,state:"prepared"}});
 expect((await prepareAndSubmitPayment(id,{})).operation?.id).toBe(old);expect(mocks.rpc).not.toHaveBeenCalledWith("tuki_submit_prepared_payment",expect.anything());
});
it("does not trust a chosen account and requires consent before resuming",async()=>{
 expect((await resumePaymentOperation(id,false)).error).toBeDefined();expect(mocks.rpc).not.toHaveBeenCalled();await recoverPaymentOperation();expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("tuki_current_payment_operation");
});
it("refuses unsupported migration and never falls back to the old financial entry point",async()=>{
 mocks.rpc.mockResolvedValue({data:{quick_receipts:true}});expect((await prepareAndSubmitPayment(id,{})).error).toContain("010");expect(mocks.rpc).toHaveBeenCalledTimes(1);
});
it("keeps lookup errors ambiguous and uses owner-checked RPCs to acknowledge or cancel",async()=>{
 mocks.rpc.mockResolvedValueOnce({error:{message:"private backend",code:"XX000"}});expect(await recoverPaymentOperation()).toMatchObject({unknown:true});await resolvePaymentOperation(id,"ack");expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_ack_payment_operation",{p_id:id});await resolvePaymentOperation(id,"cancel");expect(mocks.rpc).toHaveBeenLastCalledWith("tuki_cancel_payment_operation",{p_id:id});
});
