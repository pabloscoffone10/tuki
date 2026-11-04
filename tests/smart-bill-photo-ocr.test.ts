// Opt-in: local photographs + free public Tesseract language models; never Gemini.
import {it,expect} from "vitest";
import {createWorker,PSM} from "tesseract.js";
import {mkdirSync,writeFileSync} from "node:fs";
import captures from "./fixtures/receipts/ocr-captures.json";
import {parseReceiptDocument} from "@/features/smart-bills/receipt-parser";

it.skipIf(process.env.TUKI_RECEIPT_OCR!=="1")("measures all five original photographs using real Tesseract",async()=>{
 mkdirSync("tmp/receipt-eval",{recursive:true});
 const worker=await createWorker("spa+eng",1,{cachePath:"tmp/receipt-eval"});
 try{
  await worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_COLUMN,preserve_interword_spaces:"1"});
  const results=[];
  for(const [index,capture] of captures.entries()){
   const {data}=await worker.recognize(`tests/fixtures/receipts/${capture.file}`,{rotateAuto:true},{text:true,blocks:true});
   const lines=(data.blocks??[]).flatMap(b=>b.paragraphs).flatMap(p=>p.lines);
   const parsed=parseReceiptDocument(data.text,lines);
   const expected=["1190.00","2180.00","5320.00","1525.00","72.70"][index];
   results.push({file:capture.file,expected,items:parsed.extraction.items.map(i=>({name:i.name,quantity:i.quantity,unitPrice:i.unitPrice,subtotal:i.subtotal})),total:parsed.extraction.total,sum:parsed.analysis.totals.itemsSum,matchesExpectedSum:parsed.analysis.totals.itemsSum===expected,issues:parsed.analysis.issues});
   expect(data.text.trim().length).toBeGreaterThan(0);
   expect(parsed.extraction.adjustments).toEqual([]);
  }
  // Local report can include damaged OCR names; it is not a public fixture.
  writeFileSync("tmp/receipt-eval/live-report.json",JSON.stringify(results,null,2));
 }finally{await worker.terminate();}
},120000);
