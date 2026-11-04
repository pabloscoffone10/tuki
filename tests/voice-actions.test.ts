// @vitest-environment node
import { beforeEach,it,expect,vi } from "vitest";
const m=vi.hoisted(()=>({user:vi.fn(),group:vi.fn(),rpc:vi.fn(),interpret:vi.fn(),save:vi.fn()}));
vi.mock("@/features/auth/session",()=>({requireUser:m.user}));
vi.mock("@/features/groups/data",()=>({getGroup:m.group}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:m.rpc})}));
vi.mock("@/features/finance/actions",()=>({saveExpense:m.save}));
vi.mock("@/features/smart-bills/provider",()=>({aiConfigured:()=>true,GeminiReceiptProvider:class {interpretVoice=m.interpret;}}));
import { analyzeVoice,saveVoiceExpense } from "@/features/smart-bills/voice-actions";
const id="00000000-0000-4000-8000-000000000001";
const data={currency:"UYU",total:"100",items:[{name:"Pizza",amount:"100",payer:"yo",consumers:["Pablo"]}],adjustments:[],warnings:[],complete:true};
function form(){const f=new FormData();for(const [k,v] of Object.entries({id,groupId:id,text:"Yo pagué 100 de pizza para Pablo",consent:"yes",date:"2026-11-04",currency:"UYU",total:"100",confirmed:"yes",items:JSON.stringify([{id,name:"Pizza",amount:"100",payerId:id,consumers:[id]}])}))f.set(k,v);return f;}
beforeEach(()=>{vi.resetAllMocks();m.user.mockResolvedValue({id:"user"});m.group.mockResolvedValue({group:{id},me:{status:"active",person_id:id},members:[{person_id:id,status:"active"}]});m.interpret.mockResolvedValue(data);m.rpc.mockImplementation(async name=>({data:name==="tuki_begin_scan"?{id,lease:id,status:"processing",acquired:true}:null,error:null}));m.save.mockResolvedValue({success:"ok"});});
it("checks consent and group permission before Gemini",async()=>{const f=form();f.delete("consent");expect((await analyzeVoice(f)).error).toBeDefined();m.group.mockResolvedValue({});expect((await analyzeVoice(form())).error).toContain("permiso");expect(m.interpret).not.toHaveBeenCalled();});
it("reserves a namespaced analysis and persists only a structured draft",async()=>{expect(await analyzeVoice(form())).toMatchObject({data,self:id});expect(m.rpc).toHaveBeenCalledWith("tuki_begin_scan",expect.objectContaining({p_retry:false,p_hash:expect.stringMatching(/^[a-f0-9]{64}$/)}));expect(m.interpret).toHaveBeenCalledWith("Yo pagué 100 de pizza para Pablo");expect(m.save).not.toHaveBeenCalled();});
it("recovers without duplicate requests and does not retry an active operation",async()=>{m.rpc.mockResolvedValueOnce({data:{status:"completed",extraction:data}});expect((await analyzeVoice(form())).data).toEqual(data);m.rpc.mockResolvedValueOnce({data:{status:"processing"}});expect((await analyzeVoice(form())).error).toContain("analizando");expect(m.interpret).not.toHaveBeenCalled();});
it("rejects invalid Gemini output and keeps transport failure ambiguous",async()=>{m.interpret.mockResolvedValueOnce({items:"invalid"});expect((await analyzeVoice(form())).data).toBeUndefined();m.interpret.mockRejectedValueOnce(Error("secret"));const r=await analyzeVoice(form());expect(r.retryRequired).toBe(true);expect(JSON.stringify(r)).not.toContain("secret");});
it("requires explicit confirmation, blocks batches and checks real participants",async()=>{const f=form();f.delete("confirmed");expect((await saveVoiceExpense(f)).error).toContain("Confirmá");f.set("confirmed","yes");const one=JSON.parse(String(f.get("items")));f.set("items",JSON.stringify([...one,...one]));expect((await saveVoiceExpense(f)).error).toContain("un solo gasto");f.set("items",JSON.stringify([{...one[0],payerId:"00000000-0000-4000-8000-000000000002"}]));expect((await saveVoiceExpense(f)).error).toContain("participantes");expect(m.save).not.toHaveBeenCalled();});
it("reuses the stable expense ID and existing financial save for one expense",async()=>{await saveVoiceExpense(form());const f=m.save.mock.calls[0][1] as FormData;expect(f.get("id")).toBe(id);expect(f.get("payerId")).toBe(id);expect(f.get("amount")).toBe("100");expect(f.get("method")).toBe("equal");});
it.each([
 [{message:"scan_limit",code:"P0001"},"límite de análisis"],
 [{message:"forbidden",code:"42501"},"permiso"],
 [{message:"missing",code:"PGRST202"},"migración local 011"],
 [{message:"missing",code:"42P01"},"migración local 011"],
 [{message:"private server detail",code:"XX000"},"referencia: XX000"],
])("distinguishes reservation failures without sending text or leaking details",async(error,expected)=>{
 vi.spyOn(console,"warn").mockImplementation(()=>{});
 m.rpc.mockResolvedValue({error});const result=await analyzeVoice(form());
 expect(result.error).toContain(expected);expect(result.error).not.toContain("private server detail");expect(m.interpret).not.toHaveBeenCalled();vi.restoreAllMocks();
});
