import { z } from "zod";
import { decimalUnits } from "@/features/finance/domain";
import { BETA_CURRENCY_MESSAGE,unitRate } from "@/features/finance/beta-currency";
export const paymentSchema=z.object({id:z.uuid(),payerId:z.uuid(),receiverId:z.uuid(),amount:z.string().max(24),date:z.iso.date(),method:z.enum(["cash","bank","other"]),note:z.string().max(1000),reference:z.string().max(120),groupId:z.uuid().nullable(),selected:z.array(z.uuid()).max(100),allocationMode:z.enum(["fifo","manual"]).default("fifo"),administrative:z.boolean().optional(),administrativeReason:z.string().max(500).optional(),confirm:z.literal("yes"),currency:z.literal("UYU",{error:BETA_CURRENCY_MESSAGE}).optional(),originalCurrency:z.literal("UYU",{error:BETA_CURRENCY_MESSAGE}).optional(),original_currency:z.literal("UYU",{error:BETA_CURRENCY_MESSAGE}).optional(),rate:z.string().refine(unitRate,BETA_CURRENCY_MESSAGE).optional()}).superRefine((p,ctx)=>{
 if(p.payerId===p.receiverId)ctx.addIssue({code:"custom",message:"El pagador y el receptor deben ser distintos."});
 try{const n=decimalUnits(p.amount,2);if(n<=0n||n>100000000000000n)throw Error();}catch{ctx.addIssue({code:"custom",message:"Ingresá un importe positivo en UYU, con hasta dos decimales y punto decimal."});}
 if(new Set(p.selected).size!==p.selected.length)ctx.addIssue({code:"custom",message:"Hay obligaciones seleccionadas dos veces."});
 if(p.allocationMode==="manual"&&!p.selected.length)ctx.addIssue({code:"custom",message:"Seleccioná al menos una obligación o volvé al reparto FIFO."});
});
export const transitionSchema=z.object({id:z.uuid(),version:z.coerce.number().int().positive(),action:z.enum(["confirm","reject","void"]),reason:z.string().max(500),requestId:z.uuid(),confirm:z.literal("yes")}).superRefine((v,ctx)=>{if(v.action!=="confirm"&&v.reason.trim().length<8)ctx.addIssue({code:"custom",message:"Explicá el motivo con al menos 8 caracteres."});});
