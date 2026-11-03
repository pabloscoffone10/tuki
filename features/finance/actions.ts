"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { GroupState } from "@/features/groups/types";
import { expenseSchema } from "./schemas";
import { financeError } from "./errors";
import { calculateBill,validateReconciliation,type SmartBill } from "@/features/smart-bills/domain";
import { uploadTicket } from "@/features/smart-bills/storage";
import { TicketError } from "@/features/smart-bills/errors";
import { betaExpenseCurrency } from "./beta-currency";
function refresh(){revalidatePath("/","layout");}
const unavailable={error:"No pudimos conectar con Tuki. Volvé a intentar."};
export async function saveExpense(_state:GroupState,form:FormData):Promise<GroupState>{
 await requireUser();let shares:unknown;let bill:SmartBill|undefined;let values:Record<string,unknown>=Object.fromEntries(form);
 try{
  if(form.get("smartBill")){
   const result=calculateBill(JSON.parse(String(form.get("smartBill"))));validateReconciliation(result);bill=result.bill;
   shares=result.shares.map(({personId,input})=>({personId,input}));
   values={...values,amount:(result.original/100n).toString()+"."+(result.original%100n).toString().padStart(2,"0"),currency:bill.currency,rate:bill.rate,method:"custom"};
  }else shares=JSON.parse(String(form.get("shares")));
 }catch(e){return {error:bill||form.get("smartBill")?(e instanceof Error&&!(e instanceof z.ZodError)?e.message:"Revisá los productos y cargos de la cuenta."):"Revisá el reparto."};}
 const parsed=expenseSchema.safeParse({...values,shares});
 if(!parsed.success)return {error:parsed.error.issues[0].message};
 const {id,groupId,version,...payload}=parsed.data;
 let uploaded:Awaited<ReturnType<typeof uploadTicket>>|undefined;
 try{
  const client=await createClient();
  let previous:{currency:string;rate:string}|undefined;
  // Existing foreign ID retries are not new expenses. The SQL engine still
  // verifies their exact original hash; a changed payload cannot reuse that ID.
  const foreignRetry=version===0&&betaExpenseCurrency(payload.currency,payload.rate)!==null;
  if(version>0||foreignRetry){
   const response=await client.rpc("tuki_expense_detail",{p_id:id});
   if(response.error)return {error:foreignRetry?betaExpenseCurrency(payload.currency,payload.rate)!:financeError(response.error)};
   if(!response.data||response.data.group_id!==groupId)return {error:"No tenés acceso a este gasto histórico."};
   previous={currency:response.data.currency,rate:response.data.rate};
  }
  const currencyError=betaExpenseCurrency(payload.currency,payload.rate,previous);
  if(currencyError)return {error:currencyError};
  const data:Record<string,unknown>={...payload,removeReceipt:form.get("removeReceipt")==="yes"};
  const file=form.get("receipt");
  if(bill){
   if(file instanceof File&&file.size){uploaded=await uploadTicket(file,groupId,id,version);bill={...bill,uploadId:uploaded.id};}
   data.smartBill=bill;
  }else if(file instanceof File&&file.size){if(file.size>524288||!["image/png","image/jpeg","application/pdf"].includes(file.type))return {error:"Adjuntá PNG, JPEG o PDF de hasta 512 KiB."};data.receipt={name:file.name,mime:file.type,data:Buffer.from(await file.arrayBuffer()).toString("base64")};}
  const {error}=await client.rpc("tuki_save_expense",{p_id:id,p_group_id:groupId,p_expected_version:version,p_data:data});
  // The deterministic upload may already belong to a committed earlier attempt.
  // Never delete it on a rejected retry or an ambiguous transport outcome.
  if(error)return {error:financeError(error)};
 }catch(e){return {error:e instanceof TicketError?e.message:"No pudimos confirmar el guardado. Consultá Gastos antes de reenviar; un comprobante privado subido se conserva para evitar perder un archivo de una operación confirmada."};}
 refresh();redirect(`/gastos/${id}`);
}
export async function voidExpense(_state:GroupState,form:FormData):Promise<GroupState>{
 await requireUser();const parsed=z.object({id:z.uuid(),version:z.coerce.number().int().positive(),confirm:z.literal("yes")}).safeParse(Object.fromEntries(form));
 if(!parsed.success)return {error:"Confirmá la anulación del gasto."};
 try{const client=await createClient();const {error}=await client.rpc("tuki_void_expense",{p_id:parsed.data.id,p_expected_version:parsed.data.version,p_confirm:true});if(error)return {error:financeError(error)};}catch{return unavailable;}
 refresh();return {success:"Gasto anulado. Sus obligaciones se cancelaron y el historial se conserva."};
}
export async function safeRemoval(_state:GroupState,form:FormData):Promise<GroupState>{
 await requireUser();const parsed=z.object({mode:z.enum(["group","member","guest"]),id:z.uuid(),groupId:z.uuid().optional(),confirm:z.literal("yes")}).safeParse(Object.fromEntries(form));
 if(!parsed.success)return {error:"Confirmá la eliminación y revisá los datos."};
 const {mode,id,groupId}=parsed.data;if(mode==="member"&&!groupId)return {error:"Falta el grupo."};
 let outcome:unknown;
 try{const client=await createClient();const {data,error}=await client.rpc(mode==="group"?"tuki_delete_group":mode==="guest"?"tuki_delete_orphan_guest":"tuki_remove_member",mode==="group"?{p_group_id:id,p_confirm:true}:mode==="guest"?{p_person_id:id,p_confirm:true}:{p_group_id:groupId,p_person_id:id,p_confirm:true});if(error)return {error:financeError(error)};outcome=data;}catch{return unavailable;}
 refresh();if(mode==="group")redirect("/grupos");
 return {success:outcome==="retired"?"Participante retirado: se conservaron sus referencias históricas.":mode==="guest"?"Invitado sin referencias eliminado.":"Participación eliminada de este grupo. Su identidad global se conserva."};
}
