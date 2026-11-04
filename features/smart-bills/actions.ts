"use server";
import {filterReceiptFacts} from "./receipt-classification";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { receiptProvider } from "./provider";
import { extractionSchema,type Extraction } from "./extraction-schema";
export type ScanState={error?:string;extraction?:Extraction;status?:"pending"|"processing"|"completed"|"failed"|"recoverable";operationId?:string;retryRequired?:boolean;recovered?:boolean};
const reservation=z.object({id:z.uuid().optional(),status:z.enum(["pending","processing","completed","failed","recoverable"]),acquired:z.boolean().optional(),lease:z.uuid().optional(),extraction:z.unknown().optional(),cooldown:z.boolean().optional()});
export async function scanTicket(_state:ScanState,form:FormData):Promise<ScanState>{
 await requireUser();
 if(form.get("consent")!=="yes")return {error:"Para escanear o recuperar debés aceptar el tratamiento del ticket. La carga manual sigue disponible."};
 const group=z.uuid().safeParse(form.get("groupId"));if(!group.success)return {error:"Seleccioná un grupo válido."};
 const parsedText=z.string().trim().min(1).max(60000).safeParse(form.get("text"));
 if(!parsedText.success)return {error:"El texto del ticket debe tener entre 1 y 60.000 caracteres. Leé la foto primero o pegá su texto."};
 const text=parsedText.data;
 const provider=receiptProvider(),client=await createClient();
 let job:z.infer<typeof reservation>;
 try{
  const response=await client.rpc("tuki_begin_scan",{p_group_id:group.data,p_hash:createHash("sha256").update("ocr-text-v1\0").update(text).digest("hex"),p_provider_enabled:!!provider,p_retry:form.get("retry")==="yes"});
  if(response.error)return {status:"pending",error:response.error.message==="scan_limit"?"Alcanzaste el límite de escaneos. Podés seguir con carga manual.":response.error.code==="42501"?"Ya no tenés permiso para escanear en este grupo.":"No pudimos reservar o recuperar el escaneo. Revisá la conexión y la migración 011."};
  job=reservation.parse(response.data);
 }catch{return {status:"recoverable",error:"No sabemos si se reservó el escaneo. No enviamos el texto al proveedor; volvé a consultar con el mismo texto."};}
 const identity={operationId:job.id};
 if(job.status==="completed"){
  const parsed=extractionSchema.safeParse(job.extraction);
  return parsed.success?{...identity,status:"completed",extraction:filterReceiptFacts(parsed.data,text),recovered:true}:{...identity,status:"recoverable",error:"El resultado guardado no pudo validarse. Usá carga manual y contactá soporte con esta referencia."};
 }
 if(!job.acquired||!job.lease||!job.id||!provider){
  if(job.status==="processing")return {...identity,status:"processing",error:"Este ticket ya se está procesando. No enviamos otra solicitud; volvé a consultar con el mismo texto en unos instantes."};
  if(job.status==="recoverable")return {...identity,status:"recoverable",retryRequired:true,error:job.cooldown?"Esperá al menos un minuto antes de reintentar este resultado desconocido.":"El resultado anterior es desconocido. Consultar no repite el escaneo. Si decidís reintentarlo, aceptá explícitamente que podría generar otro costo."};
  if(job.status==="failed")return {...identity,status:"failed",error:"El proveedor no completó el escaneo anterior. Esperá un minuto y volvé a intentarlo; la carga manual sigue disponible."};
  return {...identity,status:"pending",error:"Escaneo con IA no disponible. Podés recuperar resultados existentes con el mismo texto o cargar productos manualmente."};
 }
 let extraction:Extraction;
 try{extraction=extractionSchema.parse(await provider.extract(text));}
 catch(e){
  const known=e instanceof Error&&e.name==="ReceiptProviderFailure";
  const failure=known?"provider_failed":"outcome_unknown";
  try{await client.rpc("tuki_finish_scan",{p_id:job.id,p_lease:job.lease,p_result:null,p_failure:failure});}catch{/* An expired lease still needs explicit recovery, never automatic replay. */}
  console.warn("[tuki.scan]",{operationId:job.id,outcome:failure});
  return {...identity,status:known?"failed":"recoverable",retryRequired:!known,error:known?"El proveedor no completó una lectura válida. Podés reintentar después de un minuto o continuar manualmente.":"Perdimos la respuesta del proveedor. No repetiremos la solicitud automáticamente. Consultá de nuevo con el mismo texto; un nuevo intento requiere tu aceptación explícita."};
 }
 try{
  const saved=await client.rpc("tuki_finish_scan",{p_id:job.id,p_lease:job.lease,p_result:extraction,p_failure:null});
  if(saved.error)throw Error("scan_result_not_persisted");
 }catch{
  console.warn("[tuki.scan]",{operationId:job.id,outcome:"persistence_unknown"});
  return {...identity,status:"recoverable",error:"La lectura terminó, pero no pudimos confirmar que quedó guardada. Consultá otra vez con el mismo texto; no se repetirá mientras el intento siga activo."};
 }
 return {...identity,status:"completed",extraction};
}
