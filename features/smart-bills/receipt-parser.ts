import type { Extraction } from "./extraction-schema";

export type FieldConfidence="high"|"review"|"missing";
export type ReceiptBox={x0:number;y0:number;x1:number;y1:number};
export type ReceiptOcrLine={text:string;confidence?:number;bbox?:ReceiptBox;words?:{text:string;confidence?:number;bbox?:ReceiptBox}[]};
export type ReceiptSuggestion={field:"quantity"|"unitPrice"|"subtotal";value:string;reason:string};
export type ReceiptItemEvidence={fields:Record<"name"|"quantity"|"unitPrice"|"subtotal",FieldConfidence>;sourceLines:number[];issues:string[];suggestions:ReceiptSuggestion[]};
export type ReceiptAnalysis={items:ReceiptItemEvidence[];totals:{subtotal:string|null;itemsSum:string;subtotalDifference:string|null;calculatedTotal:string|null;totalDifference:string|null};merchant:string|null;date:string|null;issues:string[];totalConfidence:FieldConfidence;blocked:boolean};
type DecimalSeparator=","|".";
type NumberFact={raw:string;value:string|null;suggestion:string|null;start:number;end:number;negative?:boolean};
type Line=ReceiptOcrLine&{source:number[]};
type Item=Extraction["items"][number];
const moneyToken=/(?:[-−]\s*)?(?:(?:UYU|USD|US\$|\$U|U\$S|\$)\s*)?[0-9OIlS]+(?:[.,][0-9OIlS]+)*/gi;
const metadata=/^(?:RUT|RUC|CI|CFE|I\.?V\.?A\.?|NETO|EXENTO|IMPUESTO|FECHA|HORA|CAJA|CAJERO|TICKET|FACTURA|BOLETA|CONSUMIDOR|CLIENTE|DIRECCI[ÓO]N|TEL[ÉE]FONO|CAMBIO|VUELTO|EFECTIVO|TARJETA|VISA|MASTER|D[ÉE]BITO|CR[ÉE]DITO|PAGO|MONEDA|CANTIDAD|DESCRIPCI[ÓO]N|PRECIO|ART[IÍ]CULOS|DOCUMENTO|SERIE)\b/i;
const decimal=(minor:bigint)=>`${minor<0n?"-":""}${(minor<0n?-minor:minor)/100n}.${String((minor<0n?-minor:minor)%100n).padStart(2,"0")}`;
const cents=(value:string)=>BigInt(value.replace(".",""));
function quantityUnits(value:string){const [whole,fraction=""]=value.split(".");return BigInt(whole)*10000n+BigInt(fraction.padEnd(4,"0"));}
function lineAmount(item:Item){if(item.subtotal!==null)return cents(item.subtotal);if(item.quantity&&item.unitPrice)return (quantityUnits(item.quantity)*cents(item.unitPrice)+5000n)/10000n;return null;}
function applyAdjustments(base:bigint,adjustments:Extraction["adjustments"]){
 let result=base;
 for(const adjustment of adjustments){
  const amount=adjustment.amount?cents(adjustment.amount):adjustment.percent?(result*quantityUnits(adjustment.percent)+500000n)/1000000n:0n;
  result+=adjustment.kind==="discount"||(adjustment.kind==="rounding"&&adjustment.subtract)?-amount:amount;
 }
 return result;
}

/** Bare grouped values need document context; an isolated 1.234 is not a decimal price. */
export function parseReceiptAmount(input:string,separator?:DecimalSeparator):string|null{
 const currency=/(?:\$|\bUYU\b|\bUSD\b)/i.test(input);
 const value=input.replace(/(?:UYU|USD|US\$|\$U|U\$S|\$)/gi,"").trim();
 if(!/^\d+(?:[.,]\d+)*$/.test(value))return null;
 let normalized:string;
 if(value.includes(",")&&value.includes(".")){
  const decimalMark=value.lastIndexOf(",")>value.lastIndexOf(".")?",":".";
  const grouping=decimalMark===","?".":",";
  if(!new RegExp(`^\\d{1,3}(?:\\${grouping}\\d{3})+\\${decimalMark}\\d{2}$`).test(value))return null;
  normalized=value.split(grouping).join("").replace(decimalMark,".");
 }else if(/^\d+[.,]\d{2}$/.test(value))normalized=value.replace(",",".");
 else if(/^\d+$/.test(value))normalized=`${value}.00`;
 else {
  const mark=value.includes(",")?",":".";
  if((separator&&separator!==mark)||currency){
   if(!new RegExp(`^\\d{1,3}(?:\\${mark}\\d{3})+$`).test(value))return null;
   normalized=`${value.split(mark).join("")}.00`;
  }else return null;
 }
 return /^\d{1,12}\.\d{2}$/.test(normalized)?normalized:null;
}
function detectSeparator(text:string):DecimalSeparator|undefined{
 const comma=(text.match(/\d,\d{2}(?!\d)/g)??[]).length;
 const dot=(text.match(/\d\.\d{2}(?!\d)/g)??[]).length;
 if(comma>dot)return ",";if(dot>comma)return ".";
 if(/\$\s*\d{1,3}(?:\.\d{3})+\b/.test(text))return ",";
 if(/\$\s*\d{1,3}(?:,\d{3})+\b/.test(text))return ".";
 if((text.match(/\b\d{1,3}(?:\.\d{3})+\b/g)??[]).length>=2)return ",";
 if((text.match(/\b\d{1,3}(?:,\d{3})+\b/g)??[]).length>=2)return ".";
 return undefined;
}
function facts(text:string,separator:DecimalSeparator|undefined):NumberFact[]{
 return [...text.matchAll(moneyToken)].filter(match=>{
  const before=text[(match.index??0)-1]??"",after=text[(match.index??0)+match[0].length]??"";
  return !/[a-záéíóúñ]/i.test(before)&&!/[a-záéíóúñ]/i.test(after)&&/\d/.test(match[0]);
 }).map(match=>{
  const raw=match[0].replace(/^[-−]\s*/,"");
  const value=parseReceiptAmount(raw,separator);
  const corrected=raw.replace(/[Oo]/g,"0").replace(/[iIl]/g,"1").replace(/[Ss]/g,"5");
  return {raw,value,suggestion:value===null&&corrected!==raw?parseReceiptAmount(corrected,separator):null,start:match.index!,end:match.index!+match[0].length,negative:/^[-−]/.test(match[0])};
 });
}
function positionalLines(text:string,input?:ReceiptOcrLine[]):Line[]{
 const lines:Line[]=(input?.length?input:text.split(/\r?\n/).map(text=>({text}))).slice(0,600).map((line,index)=>({...line,text:line.text.slice(0,1000).trim(),source:[index]}));
 if(!lines.length||lines.some(line=>!line.bbox))return lines;
 const sorted=lines.sort((a,b)=>a.bbox!.y0-b.bbox!.y0||a.bbox!.x0-b.bbox!.x0),grouped:Line[]=[];
 for(const line of sorted){
  const previous=grouped.at(-1),box=line.bbox!;
  if(previous?.bbox&&Math.abs((previous.bbox.y0+previous.bbox.y1)/2-(box.y0+box.y1)/2)<Math.min(previous.bbox.y1-previous.bbox.y0,box.y1-box.y0)*0.45&&box.x0>=previous.bbox.x1){
   previous.text+=` ${line.text}`;previous.source.push(...line.source);previous.bbox={...previous.bbox,x1:box.x1,y0:Math.min(box.y0,previous.bbox.y0),y1:Math.max(box.y1,previous.bbox.y1)};
   previous.confidence=previous.confidence===undefined?line.confidence:Math.min(previous.confidence,line.confidence??previous.confidence);
  }else grouped.push({...line});
 }
 return grouped;
}

export function parseReceiptDocument(text:string,ocrLines?:ReceiptOcrLine[]):{extraction:Extraction;analysis:ReceiptAnalysis}{
 const bounded=text.slice(0,60000),separator=detectSeparator(bounded);
 const extraction:Extraction={currency:null,total:null,items:[],adjustments:[],warnings:[],complete:false};
 const analysis:ReceiptAnalysis={items:[],totals:{subtotal:null,itemsSum:"0.00",subtotalDifference:null,calculatedTotal:null,totalDifference:null},merchant:null,date:null,issues:[],totalConfidence:"missing",blocked:false};
 const lines=positionalLines(bounded,ocrLines),totals:string[]=[],subtotals:string[]=[],adjustmentKeys=new Set<string>();
 const currencyCodes=[...new Set([...(bounded.match(/\b(?:UYU|USD|EUR|ARS|BRL|MXN)\b/gi)??[]).map(code=>code.toUpperCase()),...(/pesos uruguayos|\$\s*U\b|\bU\$/i.test(bounded)?["UYU"]:[]),...(/US\$|U\$S/i.test(bounded)?["USD"]:[])])];
 if(currencyCodes.length===1)extraction.currency=currencyCodes[0];
 const date=bounded.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
 if(date){
  const parsed=new Date(Date.UTC(Number(date[3]),Number(date[2])-1,Number(date[1])));
  if(parsed.getUTCFullYear()===Number(date[3])&&parsed.getUTCMonth()===Number(date[2])-1&&parsed.getUTCDate()===Number(date[1]))analysis.date=`${date[3]}-${date[2].padStart(2,"0")}-${date[1].padStart(2,"0")}`;
 }
 let pending:Line[]=[];
 let pendingDetail:{quantity:string;unit:NumberFact;source:number[]}|null=null;
 let totalsStarted=false;
 let totalOcrHigh=true;
 const issue=(message:string)=>{if(!analysis.issues.includes(message))analysis.issues.push(message);};
 function addItem(name:string,quantity:string|null,unit:NumberFact|undefined,subtotal:NumberFact|undefined,source:Line[]){
  name=name.replace(/^[-•*]+\s*/,"").replace(/[:=]+$/g,"").trim();
  if(!name||!/[a-záéíóúñ]/i.test(name)||name.length>120||extraction.items.length>=80)return;
  if(unit?.negative||subtotal?.negative){issue("Hay una línea con importe negativo sin identificar como descuento. Revisala manualmente.");return;}
  const item:Item={name,quantity,unitPrice:unit?.value??null,subtotal:subtotal?.value??null,discount:null,uncertain:true};
  const high=source.every(line=>(line.confidence??0)>=75);
  const evidence:ReceiptItemEvidence={fields:{name:high?"high":"review",quantity:quantity?(high?"high":"review"):"missing",unitPrice:item.unitPrice?(high?"high":"review"):"missing",subtotal:item.subtotal?(high?"high":"review"):"missing"},sourceLines:source.flatMap(line=>line.source),issues:[],suggestions:[]};
  for(const [field,fact] of [["unitPrice",unit],["subtotal",subtotal]] as const){
   if(fact?.suggestion){evidence.suggestions.push({field,value:fact.suggestion,reason:`Posible confusión OCR en «${fact.raw}». Compará con la foto antes de aceptar.`});evidence.fields[field]="review";}
  }
  extraction.items.push(item);analysis.items.push(evidence);
 }
 for(let index=0;index<lines.length;index++){
  const line=lines[index],clean=line.text.replace(/[×✕]/g,"x").replace(/\s+/g," ").trim();
  if(!clean)continue;
  const numbers=facts(clean,separator),last=numbers.at(-1),ends=last&&/^[\s.:]*$/.test(clean.slice(last.end));
  if(/^(?:SUB\s*TOTAL)(?:\s+IMPRESO)?\b/i.test(clean)){
   if(ends&&last.value)subtotals.push(last.value);pending=[];pendingDetail=null;continue;
  }
  if(/^(?:TOTAL(?:\s+(?:A\s+PAGAR|CONTADO|FINAL|GENERAL|IMPRESO))?|IMPORTE\s+TOTAL|A\s+PAGAR)\b/i.test(clean)){
   if(ends&&last.value){totals.push(last.value);totalOcrHigh=totalOcrHigh&&(line.confidence??0)>=75;}else issue("El total impreso no se reconoció de forma inequívoca.");pending=[];pendingDetail=null;totalsStarted=true;continue;
  }
  const adjustmentKind=/descuento|bonificaci[óo]n|\bdto\b/i.test(clean)?"discount":/propina|\btip\b/i.test(clean)?"tip":/servicio|cargo|recargo|cubierto\s+adicional/i.test(clean)?"service":/redondeo/i.test(clean)?"rounding":null;
  const tax=/^(?:IVA|I\.V\.A\.?|IMPUESTO|TAX)\b/i.test(clean);
  if(adjustmentKind||tax){
   const included=!/no\s+incluid/i.test(clean)&&/incluid[oa]|incl\.?\b/i.test(clean);
   if(tax&&included){issue("Impuesto incluido: no se suma nuevamente al gasto.");pending=[];continue;}
   if(tax&&!/adicional|no\s+incluid|extra/i.test(clean)){issue("Revisá manualmente si el impuesto está incluido; no se agregó automáticamente.");pending=[];continue;}
   const percent=last&&/^%\s*(?:incluid[oa])?\.?$/i.test(clean.slice(last.end));
   if((ends||percent)&&last?.value){
    const kind=adjustmentKind??"service",label=clean.slice(0,last.start).replace(/[-−:=]+$/g,"").trim().slice(0,80)||"Cargo";
    const key=`${kind}:${label.toLowerCase()}:${last.value}:${percent?"percent":"fixed"}`;
    if((!totalsStarted||!adjustmentKeys.has(key))&&extraction.adjustments.length<12){extraction.adjustments.push({label,kind,amount:percent?null:last.value,percent:percent?last.value:null,included:kind==="tip"?(included?true:null):true,subtract:kind==="discount"||(kind==="rounding"&&last.negative===true)});adjustmentKeys.add(key);}
   }else issue("Hay descuentos, propinas o cargos ilegibles: completalos manualmente.");
   pending=[];pendingDetail=null;continue;
  }
  if(metadata.test(clean)||/^(?:(?:UYU|USD|EUR|ARS|BRL|MXN)\s*)+$/i.test(clean)){pending=[];pendingDetail=null;continue;}
  if(totalsStarted)continue;
  const multiplication=clean.match(/(?:^|\s)(\d{1,12}(?:[.,]\d{1,4})?)\s*[x@]\s*/i);
  if(multiplication){
   const quantity=multiplication[1].replace(",","."),before=clean.slice(0,multiplication.index).trim().replace(/[:=]+$/g,"").trim();
   const afterStart=(multiplication.index??0)+multiplication[0].length,after=clean.slice(afterStart),values=facts(after,separator);
   const first=values[0],tail=values.at(-1),afterName=first?after.slice(0,first.start).trim():after,name=before||afterName;
   if(first){
    const unit={...first,start:first.start+afterStart,end:first.end+afterStart},subtotal=values.length>1?{...tail!,start:tail!.start+afterStart,end:tail!.end+afterStart}:undefined;
    if(name){addItem([...pending.map(line=>line.text),name].join(" "),quantity,unit,subtotal,[...pending,line]);pending=[];pendingDetail=null;}
    else if(pending.length){addItem(pending.map(line=>line.text).join(" "),quantity,unit,subtotal,[...pending,line]);pending=[];pendingDetail=null;}
    else if(extraction.items.length&&extraction.items.at(-1)!.quantity===null&&subtotal?.value!==null&&subtotal?.value!==undefined&&subtotal.value===extraction.items.at(-1)!.subtotal){
     const previous=extraction.items.at(-1)!,evidence=analysis.items.at(-1)!;previous.quantity=quantity;previous.unitPrice=unit.value;
     if(subtotal)previous.subtotal=subtotal.value;evidence.sourceLines.push(...line.source);evidence.fields.quantity="review";evidence.fields.unitPrice=unit.value?"review":"missing";
     if(unit.suggestion)evidence.suggestions.push({field:"unitPrice",value:unit.suggestion,reason:`Posible confusión OCR en «${unit.raw}». Revisá la foto.`});
    }else pendingDetail={quantity,unit,source:line.source};
   }
   continue;
  }
  if(ends){
   const trailing:NumberFact[]=[last];
   for(let pos=numbers.length-2;pos>=0;pos--){const next=trailing[0],candidate=numbers[pos];if(!/^[\s=]+$/.test(clean.slice(candidate.end,next.start)))break;trailing.unshift(candidate);}
   let name=clean.slice(0,trailing[0].start).replace(/[:=]+$/g,"").trim(),quantity:string|null=null,unit:NumberFact|undefined;
   if(trailing.length>=3&&/^\d{1,12}(?:[.,]\d{1,4})?$/.test(trailing[0].raw)){quantity=trailing[0].raw.replace(",",".");unit=trailing.at(-2);}
   else if(trailing.length>=2){unit=trailing.at(-2);const prefix=name.match(/^(\d{1,4}(?:[.,]\d{1,4})?)\s+(.+)$/);if(prefix){quantity=prefix[1].replace(",",".");name=prefix[2];}}
   if(pendingDetail){quantity=pendingDetail.quantity;unit=pendingDetail.unit;}
   const sources=[...pending,line];if(pendingDetail)sources.push({text:"",source:pendingDetail.source});
   if(!name&&pending.length)name=pending.map(line=>line.text).join(" ");else if(pending.length)name=[...pending.map(line=>line.text),name].join(" ");
   if(name)addItem(name,quantity,unit,last,sources);
   pending=[];pendingDetail=null;continue;
  }
  // Only adjacent name lines are joined; metadata and totals reset this state.
  if(/[a-záéíóúñ]/i.test(clean)&&!/[0-9]{5,}|https?:|www\.|@/.test(clean)){
   if(!analysis.merchant&&index<4&&!pending.length&&!extraction.items.length&&(metadata.test(lines[index+1]?.text??"")||/restaurante|supermercado|parrilla|caf[eé]|\bbar\b|\bS\.A\./i.test(clean))){analysis.merchant=clean.slice(0,120);continue;}
   pending=[...pending,line].slice(-2);
  }else pending=[];
 }
 const uniqueTotals=[...new Set(totals)],uniqueSubtotals=[...new Set(subtotals)];
 if(uniqueTotals.length===1)extraction.total=uniqueTotals[0];else if(uniqueTotals.length>1)issue("Se detectaron totales distintos: elegí el correcto comparando con la foto.");
 if(uniqueSubtotals.length===1)analysis.totals.subtotal=uniqueSubtotals[0];else if(uniqueSubtotals.length>1)issue("Se detectaron subtotales distintos: revisalos manualmente.");
 let sum=0n,allAmounts=true;
 extraction.items.forEach((item,index)=>{
  const evidence=analysis.items[index],value=lineAmount(item);
  if(value===null)allAmounts=false;else sum+=value-(item.discount?cents(item.discount):0n);
  if(item.quantity&&item.unitPrice&&item.subtotal){
   const units=quantityUnits(item.quantity),unit=cents(item.unitPrice),subtotal=cents(item.subtotal),computed=(units*unit+5000n)/10000n;
   if(computed!==subtotal){
    evidence.issues.push(`Cantidad × precio unitario da ${decimal(computed)}, pero la línea dice ${item.subtotal}.`);evidence.fields.quantity="review";evidence.fields.unitPrice="review";evidence.fields.subtotal="review";
    if(units>0n&&subtotal*10000n%units===0n)evidence.suggestions.push({field:"unitPrice",value:decimal(subtotal*10000n/units),reason:"Alternativa matemática usando la cantidad y el importe impresos; verificá cuál dato es incorrecto."});
    evidence.suggestions.push({field:"subtotal",value:decimal(computed),reason:"Alternativa matemática usando cantidad y precio unitario; verificá la foto antes de aceptar."});analysis.blocked=true;
   }
  }
 });
 analysis.totals.itemsSum=decimal(sum);
 if(analysis.totals.subtotal&&allAmounts){const difference=sum-cents(analysis.totals.subtotal);analysis.totals.subtotalDifference=decimal(difference);if(difference!==0n){issue(`Suma de productos ${decimal(sum)}; subtotal impreso ${analysis.totals.subtotal}; diferencia ${decimal(difference)}. Revisá productos omitidos o mal leídos.`);analysis.blocked=true;}}
 const calculated=applyAdjustments(sum,extraction.adjustments);
 if(allAmounts){analysis.totals.calculatedTotal=decimal(calculated);if(extraction.total){const difference=calculated-cents(extraction.total);analysis.totals.totalDifference=decimal(difference);if(difference!==0n){issue(`Total calculado ${decimal(calculated)}; total impreso ${extraction.total}; diferencia ${decimal(difference)}.`);analysis.blocked=true;}}}
 if(extraction.total&&(analysis.totals.subtotal||allAmounts)){
  const printed=applyAdjustments(analysis.totals.subtotal?cents(analysis.totals.subtotal):sum,extraction.adjustments);
  if(printed===cents(extraction.total))for(const adjustment of extraction.adjustments)if(adjustment.kind==="tip"&&adjustment.included===null)adjustment.included=true;
 }
 if(!extraction.total)issue("No se identificó un total final inequívoco.");
 if(!extraction.currency)issue("La moneda no es inequívoca; el símbolo $ no identifica un país. Confirmala antes de importar.");
 if(!extraction.items.length)issue("No se identificaron productos con importes legibles. Usá carga manual o Gemini opcional.");
 if(extraction.items.length===80)issue("Se alcanzó el límite de 80 productos. Revisá que no falten líneas.");
 if(extraction.items.some(item=>item.quantity===null))issue("Hay cantidades no reconocidas: completalas manualmente; no se asumió una unidad.");
 analysis.totalConfidence=extraction.total?(analysis.blocked?"review":totalOcrHigh&&allAmounts?"high":"review"):"missing";
 extraction.warnings=["OCR por reglas: compará los datos y las sugerencias con la foto antes de confirmar.",...analysis.issues].slice(0,20).map(message=>message.slice(0,240));
 return {extraction,analysis};
}
export function parseReceiptText(text:string):Extraction{return parseReceiptDocument(text).extraction;}
