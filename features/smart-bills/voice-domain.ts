import { z } from "zod";
import { allocate, convertToUyu } from "@/features/finance/domain";
import type { FinancePerson } from "@/features/finance/types";
import { normalizeDecimalInput } from "@/lib/decimal-input";

const amount=z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/).nullable();
export const voiceSchema=z.object({
 currency:z.enum(["UYU"]).nullable(), total:amount,
 items:z.array(z.object({name:z.string().max(120).nullable(),amount,payer:z.string().max(120).nullable(),consumers:z.array(z.string().max(120)).max(100)}).strict()).max(40),
 adjustments:z.array(z.string()).max(0),warnings:z.array(z.string().max(240)).max(20),complete:z.boolean(),
}).strict();
export type VoiceExtraction=z.infer<typeof voiceSchema>;
export type VoiceItem={id:string;name:string;amount:string;payerId:string;consumers:string[]};
export function resolveVoice(data:VoiceExtraction,people:FinancePerson[],self?:string):VoiceItem[]{
 const active=people.filter(p=>p.status==="active"&&!p.replaced);
 const key=(s:string)=>s.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLocaleLowerCase();
 const resolve=(name:string|null)=>{
  if(!name)return "";
  if(key(name)==="yo")return active.some(p=>p.id===self)?self!:"";
  const matches=active.filter(p=>p.id===name||key(p.name)===key(name));
  return matches.length===1?matches[0].id:"";
 };
 return data.items.map(i=>({id:crypto.randomUUID(),name:i.name??"",amount:i.amount??"",payerId:resolve(i.payer),consumers:i.consumers.every(n=>!!resolve(n))?[...new Set(i.consumers.map(resolve))]:[]}));
}
export function voiceSummary(items:VoiceItem[],people:FinancePerson[],total:string){
 if(!items.length)throw Error("Agregá al menos un gasto.");
 const ledger=new Map(people.map(p=>[p.id,{...p,paid:0n,consumed:0n}]));let sum=0n;
 for(const item of items){
  if(!item.name.trim())throw Error("Completá el concepto.");
  const payer=ledger.get(item.payerId);
  if(!payer||payer.status!=="active"||payer.replaced)throw Error(`¿Quién pagó ${item.name}?`);
  const value=convertToUyu(normalizeDecimalInput(item.amount,2),"UYU","1").total;
  if(item.consumers.some(id=>!ledger.has(id)||ledger.get(id)!.status!=="active"||ledger.get(id)!.replaced))throw Error("Revisá los consumidores.");
  const shares=allocate(value,"equal",item.consumers.map(personId=>({personId,input:"1"})));
  payer.paid+=value;sum+=value;for(const s of shares)ledger.get(s.personId)!.consumed+=s.amount;
 }
 const difference=total?sum-convertToUyu(normalizeDecimalInput(total,2),"UYU","1").total:null;
 return {total:sum,difference,ledger:[...ledger.values()].filter(p=>p.paid||p.consumed)};
}
