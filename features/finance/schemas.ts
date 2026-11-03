import { z } from "zod";
import { allocate, convertToUyu, currencies } from "./domain";
export const expenseSchema=z.object({
 id:z.uuid(),groupId:z.uuid(),version:z.coerce.number().int().min(0).max(2147483646),title:z.string().trim().min(1).max(120),notes:z.string().max(2000),
 date:z.iso.date(),category:z.enum(["food","travel","home","sports","other"]),currency:z.enum(currencies),amount:z.string().max(24),rate:z.string().max(24),payerId:z.uuid(),method:z.enum(["equal","percent","custom","units"]),
 shares:z.array(z.object({personId:z.uuid(),input:z.string().max(24)})).min(1).max(100),
}).superRefine((value,ctx)=>{try{allocate(convertToUyu(value.amount,value.currency,value.rate).total,value.method,value.shares);}catch(error){ctx.addIssue({code:"custom",message:error instanceof Error?error.message:"Reparto inválido."});}});
