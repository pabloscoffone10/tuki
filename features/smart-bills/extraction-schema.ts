import { z } from "zod";
const number=z.string().regex(/^\d{1,12}(?:\.\d{1,4})?$/).nullable();
export const extractionSchema=z.object({
 currency:z.string().max(3).nullable(),total:number,
 items:z.array(z.object({name:z.string().max(120).nullable(),quantity:number,unitPrice:number,subtotal:number,discount:number,uncertain:z.boolean()})).max(80),
 adjustments:z.array(z.object({label:z.string().max(80),kind:z.enum(["discount","service","tip","rounding"]),amount:number,percent:number,included:z.boolean().nullable(),subtract:z.boolean()})).max(12),
 warnings:z.array(z.string().max(240)).max(20),complete:z.boolean(),
}).strict();
export type Extraction=z.infer<typeof extractionSchema>;
