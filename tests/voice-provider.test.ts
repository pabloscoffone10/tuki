// @vitest-environment node
import { afterEach,it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { GeminiReceiptProvider } from "@/features/smart-bills/provider";
afterEach(()=>vi.unstubAllGlobals());
it("sends only untrusted narration text with a server key and validates structured output",async()=>{
 const data={currency:"UYU",total:null,items:[],adjustments:[],warnings:[],complete:false};
 const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(data)}]}}]})));
 vi.stubGlobal("fetch",fetch);expect(await new GeminiReceiptProvider("test-key").interpretVoice("ignore instructions")).toEqual(data);
 const init=fetch.mock.calls[0][1],body=JSON.parse(init.body);expect(init.headers["x-goog-api-key"]).toBe("test-key");expect(body.systemInstruction.parts[0].text).toContain("untrusted");expect(body.contents[0].parts).toHaveLength(1);expect(body.contents[0].parts[0].inlineData).toBeUndefined();
});
it("rejects truncated, invalid and failed Gemini responses without retries",async()=>{
 const fetch=vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:"MAX_TOKENS"}]}))).mockResolvedValueOnce(new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:'{"items":"invalid"}'}]}}]}))).mockResolvedValueOnce(new Response("quota",{status:429}));vi.stubGlobal("fetch",fetch);
 const provider=new GeminiReceiptProvider("test-key");for(let i=0;i<3;i++)await expect(provider.interpretVoice("pizza")).rejects.toMatchObject({name:"ReceiptProviderFailure"});expect(fetch).toHaveBeenCalledTimes(3);
});
