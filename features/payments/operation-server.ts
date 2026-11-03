import "server-only";
import { createClient } from "@/lib/supabase/server";
import { operationLog } from "@/lib/operation-log";
import { paymentError } from "./errors";
import { operationMessage,type OperationReply,type PaymentOperation } from "./operation-types";

export async function prepareAndSubmitPayment(id:string,payload:Record<string,unknown>):Promise<OperationReply>{
 try{
  const client=await createClient();
  const capability=await client.rpc("tuki_payment_workspace",{p_group_id:payload.groupId??null});
  if(capability.error||!capability.data?.operation_protocol)return {error:"Aplicá la migración 010 antes de registrar pagos. No se envió una operación financiera."};
  if(payload.administrative&&(typeof payload.administrativeReason!=="string"||payload.administrativeReason.trim().length<8)&&!capability.data.optional_admin_reason)return {error:"Aplicá la migración 012 para confirmar administrativamente sin un motivo adicional de ocho caracteres. No se envió el pago."};
  const prepared=await client.rpc("tuki_prepare_payment",{p_id:id,p_data:payload,p_confirm:true});
  if(prepared.error){
   if(prepared.error.message==="operation_unresolved"){
    const current=await client.rpc("tuki_current_payment_operation");
    return current.error?{unknown:true,error:"Hay un intento anterior pendiente de conciliación. Consultá su resultado antes de continuar."}:{operation:current.data,error:"Recuperamos tu intento anterior. No se creó un segundo pago."};
   }
   operationLog("payment_prepare",id,prepared.error.code);
   return {error:paymentError(prepared.error)};
  }
  const result=await client.rpc("tuki_submit_prepared_payment",{p_id:id});
  if(result.error){operationLog("payment_submit",id,result.error.code);return {unknown:true,error:"No conocemos el resultado del envío. Consultá la operación original; no generes otro pago."};}
  const operation=result.data as PaymentOperation;
  return {operation,...(operation.state==="rejected"?{error:paymentError({message:operation.error_code})}:{success:operationMessage(operation)})};
 }catch{operationLog("payment_submit",id);return {unknown:true,error:"Se perdió la conexión. El resultado puede haberse confirmado. Consultá el intento original antes de continuar."};}
}
