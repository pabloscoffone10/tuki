"use client";
import type { Page,PSM } from "tesseract.js";
import { parseReceiptDocument,type ReceiptOcrLine } from "./receipt-parser";
import { prepareReceiptImage } from "./receipt-image";

export type LocalReceiptResult=ReturnType<typeof parseReceiptDocument>&{text:string;qualityWarnings:string[];selectedVariant:string;candidateCount:number;reused?:boolean};
type Candidate=LocalReceiptResult&{confidence:number};
let cached:{hash:string;result:LocalReceiptResult}|undefined;
let fallbackCache=new WeakMap<File,LocalReceiptResult>();

export function clearLocalOcrCache(){cached=undefined;fallbackCache=new WeakMap();}
function abortError(){return new DOMException("Lectura cancelada","AbortError");}
function check(signal?:AbortSignal){if(signal?.aborted)throw abortError();}

function linesFromPage(page:Page):ReceiptOcrLine[]{
 return (page.blocks??[]).flatMap(block=>block.paragraphs??[]).flatMap(paragraph=>paragraph.lines??[]).slice(0,600).map(line=>({
  text:line.text,confidence:line.confidence,bbox:line.bbox,
  words:(line.words??[]).slice(0,100).map(word=>({text:word.text,confidence:word.confidence,bbox:word.bbox})),
 }));
}
function candidateFromPage(page:Page,variant:string):Candidate{
 const text=page.text.slice(0,60000),parsed=parseReceiptDocument(text,linesFromPage(page));
 return {...parsed,text,qualityWarnings:[],selectedVariant:variant,candidateCount:1,confidence:Number.isFinite(page.confidence)?page.confidence:0};
}
function score(candidate:Candidate){
 const totals=candidate.analysis.totals;
 // Internal ranking uses actual OCR evidence and structure, never a displayed accuracy percentage.
 return candidate.confidence+Math.min(20,candidate.extraction.items.length)*1.5+(candidate.extraction.total?5:0)
  +(totals.totalDifference==="0.00"?8:0)+(totals.subtotalDifference==="0.00"?4:0)-Math.min(10,candidate.analysis.issues.length);
}
function selectCandidate(candidates:Candidate[]){
 const baseline=candidates[0];
 return candidates.reduce((best,current)=>{
  // A superficially tidy short reading must not replace a more complete ticket.
  if(baseline.extraction.items.length>=3&&current.extraction.items.length<baseline.extraction.items.length*0.75)return best;
  return score(current)>score(best)+2?current:best;
 },baseline);
}

export async function readTicketLocally(file:File,onProgress:(progress:number)=>void,signal?:AbortSignal,options?:{force?:boolean}):Promise<LocalReceiptResult>{
 check(signal);
 if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw Error("El OCR gratuito admite fotos JPG, PNG o WEBP. Para PDF usá Gemini opcional o carga manual.");
 if(!file.size||file.size>2*1024*1024)throw Error("El ticket debe pesar hasta 2 MiB.");
 let worker:Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>>|undefined;
 let prepared:Awaited<ReturnType<typeof prepareReceiptImage>>|undefined;
 let stopped=false,timer:ReturnType<typeof setTimeout>|undefined;
 const localAbort=new AbortController();
 let cancel=()=>{};
 let progress=0,pass=0;
 const report=(value:number)=>{if(!stopped){progress=Math.max(progress,Math.min(100,Math.round(value)));onProgress(progress);}};
 const cancelled=new Promise<never>((_,reject)=>{
  cancel=()=>{stopped=true;localAbort.abort();reject(signal?.aborted?abortError():Error("La lectura local tardó demasiado. Probá con otra foto o continuá manualmente."));};
  timer=setTimeout(cancel,120000);signal?.addEventListener("abort",cancel,{once:true});if(signal?.aborted)cancel();
 });
 const task=(async()=>{
  let hash:string|undefined;
  if(globalThis.crypto?.subtle&&typeof file.arrayBuffer==="function"){
   const digest=await crypto.subtle.digest("SHA-256",await file.arrayBuffer());hash=Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,"0")).join("");
  }
  if(stopped)throw abortError();
  const hit=hash&&cached?.hash===hash?cached.result:fallbackCache.get(file);
  if(hit&&!options?.force){report(100);return structuredClone({...hit,reused:true});}
  prepared=await prepareReceiptImage(file,localAbort.signal);
  if(stopped){prepared.release();throw abortError();}
  report(3);
  const {createWorker,PSM}=await import("tesseract.js");
  if(stopped)throw abortError();
  const created=await createWorker("spa+eng",1,{
   logger:message=>{
    if(message.status==="recognizing text")report(10+pass*28+message.progress*27);
    else if(pass===0&&message.status==="loading language traineddata")report(3+message.progress*6);
   },
   errorHandler:()=>{/* Job promises expose recoverable errors; suppress uncaught callbacks. */},
   cacheMethod:"write",
  });
  if(stopped){await created.terminate();throw abortError();}
  worker=created;
  const recognize=async(image:HTMLCanvasElement,variant:string,psm:PSM)=>{
   if(stopped)throw abortError();
   await created.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:"1"});
   const {data}=await created.recognize(image,{rotateAuto:true},{text:true,blocks:true});
   if(stopped)throw abortError();
   return candidateFromPage(data,variant);
  };
  const candidates=[await recognize(prepared.original,"Original · columnas",PSM.SINGLE_COLUMN)];
  const quality=prepared.quality,first=candidates[0];
  if(quality.small||quality.dark||quality.lowContrast||quality.shadows||quality.possiblyBlurred||first.confidence<80||first.analysis.blocked||!first.extraction.items.length){
   pass=1;
   try{
    const enhanced=await prepared.enhance();
    if(stopped)throw abortError();
    candidates.push(await recognize(enhanced,quality.shadows||quality.lowContrast?"Contraste local · bloque":"Escala y contraste · bloque",PSM.SINGLE_BLOCK));
   }
   catch(error){if(stopped||signal?.aborted)throw error;quality.warnings.push("La lectura alternativa no se completó. Se conserva la lectura original para revisión.");}
  }
  const bestSoFar=selectCandidate(candidates);
  if(bestSoFar.confidence<55||!bestSoFar.extraction.items.length){
   pass=2;
   const angle=prepared.original.width>prepared.original.height?90:180;
   try{candidates.push(await recognize(prepared.rotate(angle),`Orientación ${angle}°`,PSM.SINGLE_COLUMN));}
   catch(error){if(stopped||signal?.aborted)throw error;quality.warnings.push("No se pudo comparar otra orientación. Podés girar la foto y reintentar.");}
  }
  const selected=selectCandidate(candidates);
  if(!selected.text.trim())throw Error("No se encontró texto legible. Probá con otra foto, carga manual o Gemini opcional.");
  const warnings=[...quality.warnings];
  const facts=(candidate:Candidate)=>JSON.stringify({total:candidate.extraction.total,items:candidate.extraction.items.map(item=>[item.name,item.quantity,item.unitPrice,item.subtotal])});
  const disagreement=candidates.some(candidate=>candidate!==selected&&candidate.extraction.items.length>0&&facts(candidate)!==facts(selected));
  if(disagreement){
   warnings.push("Las lecturas alternativas difieren. Se eligió la de mejor evidencia, pero debés revisar cantidades, precios y total con la foto.");
   for(const [index,item] of selected.analysis.items.entries()){
    for(const field of ["quantity","unitPrice","subtotal"] as const)if(item.fields[field]==="high")item.fields[field]="review";
    const product=selected.extraction.items[index];
    if(!product?.name)continue;
    const comparable=(value:string|null)=>value?.toLocaleLowerCase().replace(/\s+/g," ").trim();
    for(const alternate of candidates.filter(candidate=>candidate!==selected)){
     const alternatives=alternate.extraction.items.filter(value=>comparable(value.name)===comparable(product.name));
     // Repeated identical names have no safe positional match across passes.
     if(alternatives.length!==1||selected.extraction.items.filter(value=>comparable(value.name)===comparable(product.name)).length!==1)continue;
     for(const field of ["quantity","unitPrice","subtotal"] as const){
      const value=alternatives[0][field];
      if(value!==null&&value!==product[field]&&!item.suggestions.some(suggestion=>suggestion.field===field&&suggestion.value===value))item.suggestions.push({field,value,reason:`Otra lectura de la misma foto (${alternate.selectedVariant}) reconoció este valor. Verificalo visualmente antes de aceptarlo.`});
     }
    }
   }
   selected.analysis.totalConfidence=selected.extraction.total===null?"missing":"review";
  }
  if(bestSoFar.confidence<55)warnings.push("El reconocimiento encontró texto poco confiable. Considerá repetir la foto con buena luz y el ticket derecho.");
  const result:LocalReceiptResult={text:selected.text,extraction:{...selected.extraction,warnings:[...selected.extraction.warnings,...warnings].slice(0,20)},analysis:selected.analysis,qualityWarnings:warnings,selectedVariant:selected.selectedVariant,candidateCount:candidates.length};
  if(stopped)throw abortError();
  // One successful ticket only, in memory; never persist receipt data or assignments.
  if(hash)cached={hash,result:structuredClone(result)};else{fallbackCache=new WeakMap();fallbackCache.set(file,structuredClone(result));}
  report(100);return result;
 })();
 try{return await Promise.race([task,cancelled]);}
 finally{
  stopped=true;localAbort.abort();clearTimeout(timer);signal?.removeEventListener("abort",cancel);
  // A worker still initializing is terminated by the late-resolution guard above.
  await worker?.terminate();prepared?.release();
 }
}
