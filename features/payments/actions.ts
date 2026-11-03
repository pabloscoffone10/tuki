"use server";
import { revalidatePath } from "next/cache";
import { prepareAndSubmitPayment } from "./operation-server";
import type { OperationReply } from "./operation-types";
import { operationLog } from "@/lib/operation-log";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { GroupState } from "@/features/groups/types";
import { paymentSchema,transitionSchema } from "./schemas";
import { paymentError } from "./errors";
export async function createPayment(_state:GroupState,form:FormData):Promise<GroupState & OperationReply>{
 await requireUser();const parsed=paymentSchema.safeParse({...Object.fromEntries(form),groupId:form.get("groupId")||null,selected:form.getAll("selected"),administrative:form.get("administrative")==="true"?true:undefined,administrativeReason:form.get("administrativeReason")||undefined});
 if(!parsed.success)return {error:parsed.error.issues[0].message};
 const {id,confirm:_confirm,administrative,administrativeReason,...payload}=parsed.data;void _confirm;
 try{
  const data:Record<string,unknown>={...payload};if(administrative){data.administrative=true;data.administrativeReason=administrativeReason;}else if(form.get("received")==="true")data.received=true;const file=form.get("receipt");
  if(file instanceof File&&file.size){if(file.size>524288||!["image/png","image/jpeg","application/pdf"].includes(file.type))return {error:"Adjuntá JPG, PNG o PDF de hasta 512 KiB."};data.receipt={mime:file.type,data:Buffer.from(await file.arrayBuffer()).toString("base64")};}
  const result=await prepareAndSubmitPayment(id,data);if(result.operation)revalidatePath("/","layout");return result;
 }catch{operationLog("payment_submit",id);return {unknown:true,error:"Se perdió la respuesta. Consultá el intento original antes de registrar otro pago."};}

}
export async function transitionPayment(_state:GroupState,form:FormData):Promise<GroupState>{
 await requireUser();const parsed=transitionSchema.safeParse({...Object.fromEntries(form),reason:form.get("reason")??""});if(!parsed.success)return {error:parsed.error.issues[0].message};
 const v=parsed.data;
 try{const client=await createClient();const {error}=await client.rpc("tuki_transition_payment",{p_id:v.id,p_version:v.version,p_action:v.action,p_reason:v.reason,p_request_id:v.requestId,p_confirm:true});if(error){operationLog("payment_transition",v.requestId,error.code);return {error:paymentError(error)};}}catch{operationLog("payment_transition",v.requestId);return {error:"Resultado desconocido. Consultá el estado del pago antes de repetir la confirmación o anulación."};}
 revalidatePath("/","layout");return {success:v.action==="confirm"?"Pago confirmado. El saldo pendiente se actualizó una sola vez.":v.action==="reject"?"Pago rechazado. No se descontó de la deuda.":"Pago anulado. Si estaba confirmado, se revirtieron sus asignaciones."};
}
