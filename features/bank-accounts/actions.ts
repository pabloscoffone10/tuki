"use server";
import { z } from "zod";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { bankAccountSchema,type BankAccount } from "./schema";
export async function loadBankAccounts(receiver?:string):Promise<{accounts?:BankAccount[];error?:string}>{
 await requireUser();if(receiver&&!z.uuid().safeParse(receiver).success)return {error:"Destinatario inválido."};
 try{const client=await createClient();const result=receiver?await client.rpc("tuki_recipient_bank_accounts",{p_receiver:receiver,p_currency:"UYU"}):await client.from("bank_accounts").select("id,bank,holder,identifier,currency,alias,is_default");
 if(result.error)return {error:"No pudimos consultar las cuentas. Revisá tus permisos y que esté aplicada la migración bancaria."};return {accounts:result.data as BankAccount[]};}catch{return {error:"No pudimos consultar las cuentas. Reintentá."};}
}
export async function saveBankAccount(value:unknown,remove=false){
 await requireUser();const parsed=remove?z.object({id:z.uuid()}).safeParse(value):bankAccountSchema.safeParse(value);if(!parsed.success)return {error:"Revisá los datos de la cuenta (titular, identificador y moneda)."};
 try{const client=await createClient();const {error}=await client.rpc("tuki_save_bank_account",{p_id:parsed.data.id,p_data:remove?{}:parsed.data,p_delete:remove});if(error)return {error:"No pudimos guardar la cuenta. Revisá tus permisos y la migración bancaria."};revalidatePath("/configuracion");return {success:true};}catch{return {error:"No pudimos guardar. Consultá tus cuentas antes de reintentar."};}
}
