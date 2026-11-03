"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { prepareAndSubmitPayment } from "./operation-server";
import { paymentSchema } from "./schemas";
export async function quickPayment(value:unknown){
 await requireUser();
 const result=z.object({data:z.unknown(),received:z.boolean()}).safeParse(value);if(!result.success)return {error:"Datos del pago inválidos."};
 const data=paymentSchema.safeParse(result.data.data);if(!data.success)return {error:data.error.issues[0].message};
 const {id,confirm,...payload}=data.data;void confirm;
 const outcome=await prepareAndSubmitPayment(id,{...payload,received:result.data.received});
 if(outcome.operation)revalidatePath("/","layout");return outcome;
}
