"use server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getGroup } from "@/features/groups/data";
import { saveExpense } from "@/features/finance/actions";
import { decimalUnits } from "@/features/finance/domain";
import { GeminiReceiptProvider,aiConfigured } from "./provider";
import { voiceSchema,type VoiceExtraction } from "./voice-domain";
export type VoiceState={error?:string;data?:VoiceExtraction;self?:string;retryRequired?:boolean};
export async function analyzeVoice(form:FormData):Promise<VoiceState>{
 await requireUser();
 const input=z.object({groupId:z.uuid(),text:z.string().trim().min(1).max(12000),consent:z.literal("yes")}).safeParse(Object.fromEntries(form));
 if(!input.success)return {error:"Confirmá el envío del texto (hasta 12.000 caracteres) y elegí un grupo válido."};
 const context=await getGroup(input.data.groupId,{people:false,invitations:false,events:false});
 if(!context.group||context.group.archived_at||context.me?.status!=="active")return {error:"No tenés permiso para agregar gastos en este grupo."};
 const client=await createClient();let job:{id?:string;lease?:string;status:string;acquired?:boolean;extraction?:unknown};
 try{
  const r=await client.rpc("tuki_begin_scan",{p_group_id:input.data.groupId,p_hash:createHash("sha256").update("voice-text-v1\0").update(input.data.text).digest("hex"),p_provider_enabled:aiConfigured(),p_retry:form.get("retry")==="yes"});
  if(r.error){
   if(r.error.message==="scan_limit")return {error:"Alcanzaste el límite de análisis, compartido con el escaneo de tickets. Esperá al menos un minuto; si continúa, puede haberse agotado la cuota diaria. La carga manual sigue disponible."};
   if(r.error.code==="42501")return {error:"Ya no tenés permiso para analizar gastos en este grupo. Actualizá la página y revisá tu participación."};
   if(["PGRST202","42883","42P01"].includes(r.error.code))return {error:"El servidor no tiene disponible la función de reserva de análisis. Revisá que la migración local 011 de recuperación de escaneos esté aplicada en este entorno. No se envió el texto a Gemini."};
   const code=typeof r.error.code==="string"&&/^[A-Z0-9]{5,12}$/.test(r.error.code)?r.error.code:"unknown";
   console.warn("[tuki.voice.reserve]",{code});
   return {error:`No pudimos reservar el análisis (referencia: ${code}). Revisá la conexión y la configuración del servidor. No se envió el texto a Gemini; podés continuar manualmente.`};
  }
  job=r.data;
 }catch{return {error:"No pudimos confirmar la reserva. Consultá de nuevo con el mismo texto."};}
 if(job.status==="completed"){
  const result=voiceSchema.safeParse(job.extraction);
  return result.success?{data:result.data,self:context.me.person_id}:{error:"El resultado recuperado no es válido. Continuá manualmente."};
 }
 if(!job.acquired||!job.id||!job.lease||!aiConfigured())return {retryRequired:job.status==="recoverable",error:job.status==="processing"?"El texto se está analizando. Consultá de nuevo sin repetir la solicitud.":job.status==="recoverable"?"Resultado desconocido. Consultá otra vez o aceptá explícitamente un nuevo intento después de un minuto.":"Gemini no está disponible o el intento está en espera. Continuá manualmente o consultá más tarde."};
 let data:VoiceExtraction;
 try{data=voiceSchema.parse(await new GeminiReceiptProvider(process.env.GEMINI_API_KEY!).interpretVoice(input.data.text));}
 catch(e){
  const known=e instanceof Error&&e.name==="ReceiptProviderFailure";
  try{await client.rpc("tuki_finish_scan",{p_id:job.id,p_lease:job.lease,p_result:null,p_failure:known?"provider_failed":"outcome_unknown"});}catch{}
  return {retryRequired:!known,error:known?"Gemini no devolvió una lectura válida. Continuá manualmente o consultá después de un minuto.":"Perdimos la respuesta. No repetimos el análisis automáticamente. Consultá con el mismo texto."};
 }
 try{
  const saved=await client.rpc("tuki_finish_scan",{p_id:job.id,p_lease:job.lease,p_result:data,p_failure:null});
  if(saved.error)throw Error();
 }catch{return {error:"No pudimos confirmar el resultado. Consultá con el mismo texto para recuperarlo."};}
 return {data,self:context.me.person_id};
}
// The existing expense RPC is atomic for ONE expense only. Never loop over it.
export async function saveVoiceExpense(form:FormData){
 await requireUser();
 if(form.get("confirmed")!=="yes")return {error:"Confirmá la revisión antes de guardar."};
 const parsed=z.object({id:z.uuid(),groupId:z.uuid(),date:z.iso.date(),currency:z.literal("UYU"),total:z.string().regex(/^(?:\d{1,12}(?:\.\d{1,2})?)?$/),items:z.string().max(30000)}).safeParse(Object.fromEntries(form));
 if(!parsed.success)return {error:"Revisá los datos del borrador."};
 const schema=z.array(z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),amount:z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/),payerId:z.uuid(),consumers:z.array(z.uuid()).min(1).max(100)})).length(1);
 let items;try{items=schema.parse(JSON.parse(parsed.data.items));}catch{return {error:"El guardado seguro admite un solo gasto. Varios gastos requieren una operación atómica que todavía no está disponible."};}
 if(parsed.data.total&&decimalUnits(parsed.data.total,2)!==decimalUnits(items[0].amount,2))return {error:"El total narrado no coincide con los gastos. Corregilo antes de guardar."};
 const context=await getGroup(parsed.data.groupId,{people:false,invitations:false,events:false});
 if(!context.group||context.group.archived_at||context.me?.status!=="active")return {error:"No tenés permiso para guardar en este grupo."};
 const active=new Set(context.members.filter(m=>m.status==="active"&&!m.replaced_by_person_id).map(m=>m.person_id));
 const item=items[0];if(!active.has(item.payerId)||item.consumers.some(id=>!active.has(id)))return {error:"Revisá los participantes activos del grupo."};
 const f=new FormData();
 for(const [key,value] of Object.entries({id:parsed.data.id,groupId:parsed.data.groupId,version:"0",title:item.name,notes:"",category:"other",date:parsed.data.date,currency:"UYU",rate:"1",amount:item.amount,payerId:item.payerId,method:"equal",shares:JSON.stringify(item.consumers.map(personId=>({personId,input:"1"})))}))f.set(key,value);
 return saveExpense({},f);
}
