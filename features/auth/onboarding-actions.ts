"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "./session";
import { safeNext } from "./redirects";
import { createClient } from "@/lib/supabase/server";
export async function finishPaymentOnboarding(_state:{error?:string},form:FormData):Promise<{error?:string}>{
 await requireUser();
 try{const client=await createClient();const {error}=await client.rpc("tuki_finish_payment_onboarding");if(error)return {error:"No pudimos guardar tu elección. Reintentá para continuar."};}
 catch{return {error:"No pudimos guardar tu elección. Revisá tu conexión y reintentá."};}
 revalidatePath("/","layout");redirect(safeNext(form.get("next")));
}
