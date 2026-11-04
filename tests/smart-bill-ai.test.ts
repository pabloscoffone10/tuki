// @vitest-environment node
import { afterEach,beforeEach,it,expect,vi } from "vitest";
vi.mock("server-only",()=>({}));
import { GeminiReceiptProvider,OpenAiReceiptProvider,receiptProvider,aiConfigured } from "@/features/smart-bills/provider";
import { extractionSchema } from "@/features/smart-bills/extraction-schema";
const extracted={currency:"UYU",total:"100.00",items:[{name:"Agua",quantity:"2",unitPrice:"50",subtotal:"100",discount:null,uncertain:false}],adjustments:[],warnings:[],complete:true};
const fetchMock=vi.fn();
beforeEach(()=>{vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();vi.stubEnv("GEMINI_API_KEY","");vi.stubEnv("TUKI_AI_PROVIDER","");vi.stubEnv("OPENAI_API_KEY","");vi.stubEnv("TUKI_AI_MODEL","");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("keeps manual mode available without configured provider",()=>{expect(receiptProvider()).toBeNull();expect(aiConfigured()).toBe(false);expect(fetchMock).not.toHaveBeenCalled();});
it("selects only Gemini even with legacy paid provider configuration",()=>{
 vi.stubEnv("TUKI_AI_PROVIDER","openai");vi.stubEnv("OPENAI_API_KEY","legacy");vi.stubEnv("TUKI_AI_MODEL","paid");
 expect(receiptProvider()).toBeNull();vi.stubEnv("GEMINI_API_KEY","test");expect(receiptProvider()).toBeInstanceOf(GeminiReceiptProvider);
});
it("sends Gemini an inline image and JSON schema without putting the key in the URL or body",async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify(extracted)}]}}]})));
 expect(await new GeminiReceiptProvider("test-secret").extract({bytes:Buffer.from("image"),mime:"image/png",pages:1})).toEqual(extracted);
 const [url,options]=fetchMock.mock.calls[0];expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
 expect(options.headers["x-goog-api-key"]).toBe("test-secret");expect(options.cache).toBe("no-store");
 const body=JSON.parse(options.body);expect(body.contents[0].parts[1].inlineData).toEqual({mimeType:"image/png",data:Buffer.from("image").toString("base64")});
 expect(body.generationConfig).toMatchObject({responseMimeType:"application/json",maxOutputTokens:4000});expect(body.generationConfig.responseJsonSchema.required).toContain("total");expect(options.body).not.toContain("test-secret");
});
it("does not retry Gemini quota errors or fall back to a paid provider",async()=>{
 fetchMock.mockResolvedValue(new Response("private diagnostics",{status:429}));
 await expect(new GeminiReceiptProvider("test").extract({bytes:Buffer.from("x"),mime:"image/jpeg",pages:1})).rejects.toThrow(/cuota/);expect(fetchMock).toHaveBeenCalledTimes(1);
});
it.each([
 {candidates:[{finishReason:"MAX_TOKENS",content:{parts:[{text:JSON.stringify(extracted)}]}}]},
 {promptFeedback:{blockReason:"SAFETY"}},
 {candidates:[{finishReason:"STOP",content:{parts:[{text:'{"items":[]}'}]}}]},
 {candidates:[{finishReason:"STOP",content:{parts:[{text:'not json'}]}}]},
])("rejects unsafe or incomplete Gemini responses",async response=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify(response)));
 await expect(new GeminiReceiptProvider("test").extract({bytes:Buffer.from("x"),mime:"image/png",pages:1})).rejects.toThrow(/incompleta o inválida/);
});
it("sends a bounded server-only Responses request with structured schema and no storage",async()=>{
 fetchMock.mockResolvedValue(new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(extracted)}]}]})));
 const provider=new OpenAiReceiptProvider("test-key-never-real","vision-model");expect(await provider.extract({bytes:Buffer.from("test"),mime:"image/png",pages:1})).toEqual(extracted);
 const request=JSON.parse(fetchMock.mock.calls[0][1].body);expect(request.store).toBe(false);expect(request.max_output_tokens).toBe(4000);expect(request.text.format.strict).toBe(true);expect(request.input[0].content[1].type).toBe("input_image");
 expect(JSON.stringify(request)).not.toContain("test-key-never-real");
});
it("accepts uncertain/incomplete facts without inventing missing prices",()=>{const partial={...extracted,total:null,items:[{name:null,quantity:null,unitPrice:null,subtotal:null,discount:null,uncertain:true}],warnings:["Ticket borroso"],complete:false};expect(extractionSchema.parse(partial)).toEqual(partial);});
it("supports bounded multipage PDF input",async()=>{fetchMock.mockResolvedValue(new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(extracted)}]}]})));await new OpenAiReceiptProvider("test","vision-model").extract({bytes:Buffer.from("%PDF-test"),mime:"application/pdf",pages:3});const request=JSON.parse(fetchMock.mock.calls[0][1].body);expect(request.input[0].content[1]).toMatchObject({type:"input_file",filename:"ticket.pdf"});});
it("rejects truncated/refused output and malformed extraction",async()=>{const provider=new OpenAiReceiptProvider("test","model");fetchMock.mockResolvedValue(new Response(JSON.stringify({status:"incomplete",output:[]})));await expect(provider.extract({bytes:Buffer.from("x"),mime:"image/png",pages:1})).rejects.toThrow(/incompleto/);fetchMock.mockResolvedValue(new Response(JSON.stringify({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify({items:[{name:"fiction"}]})}]}]})));await expect(provider.extract({bytes:Buffer.from("x"),mime:"image/png",pages:1})).rejects.toThrow(/formato/);});
it("does not return raw provider failures or secret details",async()=>{fetchMock.mockResolvedValue(new Response("secret provider diagnostics",{status:500}));await expect(new OpenAiReceiptProvider("test","model").extract({bytes:Buffer.from("x"),mime:"image/png",pages:1})).rejects.toThrow("El proveedor no pudo leer el ticket");});
