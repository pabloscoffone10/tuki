"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { operationLog } from "@/lib/operation-log";
import { paymentError } from "./errors";
import { operationMessage,type OperationReply,type PaymentOperation } from "./operation-types";

export async function recoverPaymentOperation(id?:string):Promise<OperationReply>{
 await requireUser();if(id&&!z.uuid().safeParse(id).success)return {error:"Referencia de operación inválida.",unknown:true};
 try{const client=await createClient();const {data,error}=id?await client.rpc("tuki_payment_operation",{p_id:id}):await client.rpc("tuki_current_payment_operation");
  if(error){operationLog("payment_lookup",id??"unavailable",error.code);return {unknown:true,error:"No pudimos conciliar tus operaciones. Revisá la conexión y la migración 010 antes de continuar."};}
  return {operation:data as PaymentOperation|null};
 }catch{operationLog("payment_lookup",id??"unavailable");return {unknown:true,error:"No pudimos consultar el resultado. No registres otro pago hasta recuperar esta operación."};}
}
export async function resumePaymentOperation(id:string,confirm:boolean):Promise<OperationReply>{
 await requireUser();if(!confirm||!z.uuid().safeParse(id).success)return {error:"Confirmá el envío del mismo intento."};
 try{const client=await createClient();const result=await client.rpc("tuki_submit_prepared_payment",{p_id:id});
  if(result.error){operationLog("payment_submit",id,result.error.code);return {unknown:true,error:"El resultado sigue siendo desconocido. Consultá la misma operación; no generes otra."};}
  const operation=result.data as PaymentOperation;revalidatePath("/","layout");return {operation,...(operation.state==="rejected"?{error:paymentError({message:operation.error_code})}:{success:operationMessage(operation)})};
 }catch{operationLog("payment_submit",id);return {unknown:true,error:"Se perdió la respuesta. La operación original sigue siendo la referencia para conciliar."};}
}
export async function resolvePaymentOperation(id:string,mode:"ack"|"cancel"):Promise<OperationReply>{
 await requireUser();if(!z.uuid().safeParse(id).success||!["ack","cancel"].includes(mode))return {error:"Operación inválida."};
 try{const client=await createClient();const {error}=await client.rpc(mode==="ack"?"tuki_ack_payment_operation":"tuki_cancel_payment_operation",{p_id:id});
  if(error)return {error:paymentError(error)};revalidatePath("/","layout");return {operation:null,success:mode==="ack"?"Resultado reconocido. Podés iniciar un pago nuevo distinto.":"Intento no enviado cancelado. No se modificó ningún saldo."};
 }catch{operationLog("payment_resolve",id);return {unknown:true,error:"No pudimos confirmar el cierre del intento. Volvé a consultar su estado."};}
}
