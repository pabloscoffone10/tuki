import {afterEach,beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({create:vi.fn(),recognize:vi.fn(),terminate:vi.fn(),prepare:vi.fn(),release:vi.fn(),enhance:vi.fn(),rotate:vi.fn(),parameters:vi.fn()}));
vi.mock("tesseract.js",()=>({createWorker:mocks.create,PSM:{SINGLE_COLUMN:"4",SINGLE_BLOCK:"6"}}));
vi.mock("@/features/smart-bills/receipt-image",async original=>{
 const actual=await original<typeof import("@/features/smart-bills/receipt-image")>();
 return {...actual,prepareReceiptImage:mocks.prepare};
});
import {readTicketLocally,clearLocalOcrCache} from "@/features/smart-bills/browser-ocr";
import {measureReceiptImage} from "@/features/smart-bills/receipt-image";
const photo=()=>new File(["image"],"ticket.png",{type:"image/png"});
const text="UYU\nAgua 2 x 50,00 100,00\nTOTAL 100,00";
const quality=()=>({dark:false,lowContrast:false,shadows:false,possiblyBlurred:false,small:false,warnings:[] as string[]});
const page=(value=text,confidence=92)=>({data:{text:value,confidence,blocks:[]}});
const image=()=>({width:1000,height:2000} as HTMLCanvasElement);
beforeEach(()=>{
 vi.resetAllMocks();clearLocalOcrCache();
 mocks.create.mockResolvedValue({recognize:mocks.recognize,terminate:mocks.terminate,setParameters:mocks.parameters});mocks.recognize.mockResolvedValue(page());
 mocks.enhance.mockResolvedValue(image());mocks.rotate.mockReturnValue(image());
 mocks.prepare.mockResolvedValue({original:image(),quality:quality(),enhance:mocks.enhance,rotate:mocks.rotate,release:mocks.release});
});
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();});
it("runs bounded Spanish/English recognition with geometry and frees resources",async()=>{
 const progress=vi.fn(),result=await readTicketLocally(photo(),progress);
 expect(result.extraction.total).toBe("100.00");expect(result.candidateCount).toBe(1);
 expect(mocks.create).toHaveBeenCalledWith("spa+eng",1,expect.objectContaining({cacheMethod:"write"}));
 expect(mocks.recognize).toHaveBeenCalledWith(expect.anything(),{rotateAuto:true},{text:true,blocks:true});
 expect(mocks.parameters).toHaveBeenCalledWith({tessedit_pageseg_mode:"4",preserve_interword_spaces:"1"});
 expect(mocks.terminate).toHaveBeenCalledOnce();expect(mocks.release).toHaveBeenCalledOnce();expect(progress).toHaveBeenLastCalledWith(100);
});
it("rejects PDFs and oversized images before starting a worker",async()=>{
 await expect(readTicketLocally(new File(["pdf"],"ticket.pdf",{type:"application/pdf"}),()=>{})).rejects.toThrow(/admite fotos/);
 await expect(readTicketLocally(new File([new Uint8Array(2*1024*1024+1)],"ticket.png",{type:"image/png"}),()=>{})).rejects.toThrow(/2 MiB/);
 expect(mocks.create).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();
});
it("compares conditional enhancement and preserves the more complete reliable reading",async()=>{
 const evidence=quality();evidence.shadows=true;
 mocks.prepare.mockResolvedValue({original:image(),quality:evidence,enhance:mocks.enhance,rotate:mocks.rotate,release:mocks.release});
 mocks.recognize.mockResolvedValueOnce(page(text,90)).mockResolvedValueOnce(page("UYU\nAgua 2 x 50,00 100,00\nTOTAL 190,00",72));
 const result=await readTicketLocally(photo(),()=>{});
 expect(result.candidateCount).toBe(2);expect(result.extraction.total).toBe("100.00");expect(result.selectedVariant).toContain("Original");expect(result.qualityWarnings.join(" ")).toContain("difieren");expect(mocks.enhance).toHaveBeenCalledOnce();
});
it("does not keep empty OCR results and releases the worker",async()=>{
 mocks.recognize.mockResolvedValue(page(" ",0));
 await expect(readTicketLocally(photo(),()=>{})).rejects.toThrow(/texto legible/);expect(mocks.terminate).toHaveBeenCalledOnce();expect(mocks.release).toHaveBeenCalledOnce();
});
it("reuses only local successful results and allows explicit reprocessing",async()=>{
 const file=photo();await readTicketLocally(file,()=>{});const reused=await readTicketLocally(file,()=>{});
 expect(reused.reused).toBe(true);expect(mocks.create).toHaveBeenCalledOnce();
 await readTicketLocally(file,()=>{},undefined,{force:true});expect(mocks.create).toHaveBeenCalledTimes(2);
});
it("cancels an active worker immediately without retaining a result",async()=>{
 let begun:()=>void=()=>{};const started=new Promise<void>(resolve=>{begun=resolve;});
 mocks.recognize.mockImplementation(()=>{begun();return new Promise(()=>{});});
 const controller=new AbortController(),operation=readTicketLocally(photo(),()=>{},controller.signal);
 const assertion=expect(operation).rejects.toMatchObject({name:"AbortError"});await started;controller.abort();await assertion;
 expect(mocks.terminate).toHaveBeenCalledOnce();expect(mocks.release).toHaveBeenCalledOnce();
});
it("cleans up a worker that finishes initializing after cancellation",async()=>{
 let complete:(value:unknown)=>void=()=>{},begun:()=>void=()=>{};const started=new Promise<void>(resolve=>{begun=resolve;});
 mocks.create.mockImplementation(()=>{begun();return new Promise(resolve=>{complete=resolve;});});
 const controller=new AbortController(),operation=readTicketLocally(photo(),()=>{},controller.signal);
 const assertion=expect(operation).rejects.toMatchObject({name:"AbortError"});await started;controller.abort();await assertion;
 complete({recognize:mocks.recognize,terminate:mocks.terminate,setParameters:mocks.parameters});
 await Promise.resolve();await Promise.resolve();expect(mocks.terminate).toHaveBeenCalledOnce();expect(mocks.recognize).not.toHaveBeenCalled();
});
it("describes low-light/low-detail image evidence without pretending to measure accuracy",()=>{
 const pixels=new Uint8ClampedArray(100*100*4);for(let i=0;i<10000;i++){pixels[i*4]=pixels[i*4+1]=pixels[i*4+2]=45;pixels[i*4+3]=255;}
 const measured=measureReceiptImage(pixels,100,100,500);
 expect(measured).toMatchObject({dark:true,lowContrast:true,possiblyBlurred:true,small:true});expect(measured.warnings.join(" ")).not.toContain("%");
});
