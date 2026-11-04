"use client";
import type { Page,PSM } from "tesseract.js";
import { parseReceiptAmount,parseReceiptDocument,type ReceiptOcrLine } from "./receipt-parser";
import { prepareReceiptImage } from "./receipt-image";

export type LocalReceiptResult=ReturnType<typeof parseReceiptDocument>&{text:string;qualityWarnings:string[];selectedVariant:string;candidateCount:number;reused?:boolean};
type Candidate=LocalReceiptResult&{confidence:number;lines:ReceiptOcrLine[]};
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
 const text=page.text.slice(0,60000),lines=linesFromPage(page),parsed=parseReceiptDocument(text,lines);
 return {...parsed,text,lines,qualityWarnings:[],selectedVariant:variant,candidateCount:1,confidence:Number.isFinite(page.confidence)?page.confidence:0};
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
  if(baseline.extraction.total&&baseline.analysis.totals.totalDifference==="0.00"&&!current.extraction.total)return best;
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
  let selected=selectCandidate(candidates);
  if(!selected.text.trim())throw Error("No se encontró texto legible. Probá con otra foto, carga manual o Gemini opcional.");
  const warnings=[...quality.warnings];
  // Re-read bounded regions of the ORIGINAL pixels. Never repair a number from a sum.
  const original=candidates[0];
  const focused=async(box:{x0:number;y0:number;x1:number;y1:number},psm:PSM,scaleY=2)=>{
   if(stopped)throw abortError();
   await created.setParameters({tessedit_pageseg_mode:psm,preserve_interword_spaces:"1"});
   const {data}=await created.recognize(prepared!.crop(box,2,scaleY),{rotateAuto:false},{text:true,blocks:true});
   if(stopped)throw abortError();return data;
  };
  try{
   const totalLines=original.lines.filter(line=>/\bTOTAL\b/i.test(line.text)&&!/^\s*SUB/i.test(line.text)&&line.bbox);
   const totalLine=totalLines.length===1?totalLines[0]:undefined;
   if(totalLine?.bbox&&(!selected.extraction.total||selected.analysis.totals.totalDifference!=="0.00")){
    const box=totalLine.bbox,h=box.y1-box.y0,label=totalLine.words?.find(word=>/^TOTAL\W*$/i.test(word.text));
    const region={x0:label?.bbox?label.bbox.x1+h*0.1:Math.max(box.x0,prepared.original.width*0.6),x1:Math.min(prepared.original.width,box.x1+h*0.7),y0:box.y0-h*0.4,y1:box.y1+h*0.3};
    const values:string[]=[];
    for(const psm of [PSM.SINGLE_LINE,PSM.SINGLE_BLOCK]){
     // Tall total fonts need wider glyphs; the amount itself is still recognized.
     const page=await focused(region,psm,0.5);
     const tokens=page.text.match(/\d+(?:[.,]\d+)*/g)??[];
     if(tokens.length===1){const value=parseReceiptAmount(tokens[0]);if(value&&page.confidence>=40)values.push(value);}
    }
    if(values.length===2&&values[0]===values[1]&&values[0]!==selected.extraction.total){
     const lines=selected.lines.map(line=>/\bTOTAL\b/i.test(line.text)&&!/^\s*SUB/i.test(line.text)?{...line,text:`TOTAL ${values[0]}`,confidence:0}:line);
     const text=lines.map(line=>line.text).join("\n"),parsed=parseReceiptDocument(text,lines);
     warnings.push(`El recorte del total reconoció ${values[0]} en dos lecturas. La lectura general era ${selected.extraction.total??"ilegible"}; revisá el total con la foto.`);
     selected={...selected,...parsed,lines,text};
    }
   }
   let attempts=0;
   for(const [index,item] of selected.extraction.items.entries()){
    if(attempts>=5)break;
    if(item.quantity!==null&&item.unitPrice!==null||!item.subtotal)continue;
    const identity=(name:string|null)=>(name??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    const alternatives=candidates.filter(candidate=>candidate!==selected).flatMap(candidate=>candidate.extraction.items.filter(value=>identity(value.name)===identity(item.name)&&value.subtotal===item.subtotal&&value.quantity&&value.unitPrice));
    const unique=new Map(alternatives.map(value=>[`${value.quantity}:${value.unitPrice}`,value]));
    const alternate=unique.size===1?[...unique.values()][0]:undefined;
    if(alternate?.quantity&&alternate.unitPrice){
     const [whole,fraction=""]=alternate.quantity.split("."),q=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,"0"));
     if(q>0n&&(q*BigInt(alternate.unitPrice.replace(".",""))+5000n)/10000n===BigInt(item.subtotal.replace(".",""))&&(item.quantity===null||Number(item.quantity)===Number(alternate.quantity))&&(item.unitPrice===null||item.unitPrice===alternate.unitPrice)){
      item.quantity=alternate.quantity;item.unitPrice=alternate.unitPrice;
      selected.analysis.items[index].fields.quantity="review";selected.analysis.items[index].fields.unitPrice="review";
      warnings.push(`Otra lectura de la misma fila reconoció cantidad y precio de «${item.name}»; revisalos con la foto.`);continue;
     }
    }
    const matches=original.extraction.items.map((value,index)=>({value,index})).filter(({value})=>value.subtotal===item.subtotal);
    if(matches.length!==1)continue;
    const sourceIndex=matches[0].index,sources=original.analysis.items[sourceIndex].sourceLines;
    const boxes=sources.map(source=>original.lines[source]?.bbox).filter((box):box is NonNullable<typeof box>=>!!box);
    if(!boxes.length)continue;
    const nextSources=original.analysis.items[sourceIndex+1]?.sourceLines??[],nextTop=Math.min(...nextSources.map(source=>original.lines[source]?.bbox?.y0??Infinity));
    const top=Math.min(...boxes.map(box=>box.y0)),bottom=Math.max(...boxes.map(box=>box.y1)),height=bottom-top;
    const region={x0:0,x1:prepared.original.width,y0:top-Math.max(8,height*0.3),y1:Math.min(nextTop+height*0.7,bottom+Math.max(30,height*2))};
    attempts++;
    const page=await focused(region,PSM.SINGLE_BLOCK);
    const details=[...page.text.matchAll(/\b(\d+(?:[.,]\d{1,4})?)\s*UN\s+X\s+(\d+(?:[.,]\d{2})?)\b/gi)];
    if(details.length!==1)continue;
    const quantity=details[0][1].replace(",","."),unit=parseReceiptAmount(details[0][2]);
    if(!unit||item.quantity!==null&&Number(item.quantity)!==Number(quantity)||item.unitPrice!==null&&item.unitPrice!==unit)continue;
    const [whole,fraction=""]=quantity.split("."),q=BigInt(whole)*10000n+BigInt(fraction.padEnd(4,"0"));
    if(q<=0n||(q*BigInt(unit.replace(".",""))+5000n)/10000n!==BigInt(item.subtotal.replace(".","")))continue;
    item.quantity=quantity;item.unitPrice=unit;
    const evidence=selected.analysis.items[index];evidence.fields.quantity="review";evidence.fields.unitPrice="review";
    warnings.push(`Cantidad y precio de «${item.name}» recuperados del recorte de su fila; revisalos con la foto.`);
   }
  }catch(error){if(stopped||signal?.aborted)throw error;warnings.push("No se completó la comprobación por recortes. Los datos ilegibles quedan pendientes de corrección.");}
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
