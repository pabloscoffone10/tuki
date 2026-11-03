import { z } from "zod";
import { allocate, convertToUyu, currencies, decimalUnits, unitsDecimal } from "@/features/finance/domain";
const decimal=z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/);
const money=z.string().regex(/^\d{1,14}(?:\.\d{1,2})?$/);
const consumer=z.object({personId:z.uuid(),input:decimal});
export const itemSchema=z.object({id:z.uuid(),name:z.string().trim().min(1).max(120),quantity:decimal,priceMode:z.enum(["unit","subtotal"]),price:money,discount:money,split:z.enum(["equal","units"]),consumers:z.array(consumer).max(100),reviewed:z.boolean()});
export const adjustmentSchema=z.object({id:z.uuid(),label:z.string().trim().min(1).max(80),kind:z.enum(["discount","service","tip","rounding"]),mode:z.enum(["fixed","percent"]),value:decimal,subtract:z.boolean(),included:z.boolean(),distribution:z.enum(["equal","proportional","custom"]),consumers:z.array(consumer).max(100),reviewed:z.boolean()});
export const billSchema=z.object({currency:z.enum(currencies),rate:z.string().max(24),items:z.array(itemSchema).min(1).max(80),adjustments:z.array(adjustmentSchema).max(12),ticketTotal:money.nullable(),noTotalReason:z.string().max(300),confirmed:z.boolean(),uploadId:z.uuid().nullable()});
export type SmartBill=z.infer<typeof billSchema>;
export type SmartItem=z.infer<typeof itemSchema>;
export type Adjustment=z.infer<typeof adjustmentSchema>;
export function calculateBill(input:unknown){
 const bill=billSchema.parse(input);const balances=new Map<string,bigint>();let subtotal=0n,discounts=0n,charges=0n,tips=0n,addedTips=0n,rounding=0n;
 if(new Set(bill.items.map(i=>i.id)).size!==bill.items.length||new Set(bill.adjustments.map(i=>i.id)).size!==bill.adjustments.length)throw Error("Hay filas duplicadas. Revisá los productos y cargos.");
 const distribute=(amount:bigint,people:{personId:string;input:string}[],method:"equal"|"units"|"custom",subtract=false)=>{
  if(!people.length||new Set(people.map(p=>p.personId)).size!==people.length)throw Error("Hay productos o cargos sin asignar, o consumidores duplicados.");
  if(amount===0n){if(method==="custom"&&people.some(p=>decimalUnits(p.input,2)!==0n))throw Error("El reparto personalizado no coincide con el cargo.");for(const p of people)if(!balances.has(p.personId))balances.set(p.personId,0n);return;}
  for(const p of allocate(amount,method,people)){const next=(balances.get(p.personId)??0n)+(subtract?-p.amount:p.amount);if(next<0n)throw Error("Un descuento deja un consumo individual negativo. Revisá su reparto.");balances.set(p.personId,next);}
 };
 for(const item of bill.items){
  if(!item.reviewed)throw Error("Revisá y confirmá los campos dudosos del ticket.");
  const quantity=decimalUnits(item.quantity,4),price=decimalUnits(item.price,2),discount=decimalUnits(item.discount,2);
  if(quantity<=0n)throw Error("La cantidad debe ser positiva.");
  const gross=item.priceMode==="unit"?(price*quantity+5000n)/10000n:price;
  if(discount>gross)throw Error("El descuento de un producto supera su importe.");
  if(item.split==="units"&&item.consumers.reduce((n,p)=>n+decimalUnits(p.input,4),0n)!==quantity)throw Error("Las cantidades asignadas deben sumar la cantidad del producto.");
  if(item.split==="units"&&item.consumers.some(p=>decimalUnits(p.input,4)<=0n))throw Error("Las cantidades asignadas deben ser positivas.");
  subtotal+=gross;discounts+=discount;distribute(gross-discount,item.consumers,item.split);
 }
 for(const adjustment of bill.adjustments){
  if(!adjustment.reviewed)throw Error("Revisá los cargos y si la propina ya está incluida en el ticket.");
  const current=[...balances.values()].reduce((n,p)=>n+p,0n);
  const amount=adjustment.mode==="percent"?(current*decimalUnits(adjustment.value,4)+500000n)/1000000n:decimalUnits(adjustment.value,2);
  const negative=adjustment.kind==="discount"||(adjustment.kind==="rounding"&&adjustment.subtract);
  if(negative&&amount>current)throw Error("Los descuentos no pueden superar el consumo.");
  const method=adjustment.distribution==="custom"?"custom":adjustment.distribution==="equal"?"equal":"units";
  const people=adjustment.distribution==="proportional"?adjustment.consumers.filter(p=>(balances.get(p.personId)??0n)>0n).map(p=>({...p,input:unitsDecimal(String(balances.get(p.personId)??0n),4)})):adjustment.consumers;
  distribute(amount,people,method,negative);
  if(adjustment.kind==="discount")discounts+=amount;
  else if(adjustment.kind==="tip"){tips+=amount;if(!adjustment.included)addedTips+=amount;}
  else if(adjustment.kind==="service")charges+=amount;
  else rounding+=negative?-amount:amount;
 }
 const original=[...balances.values()].reduce((n,p)=>n+p,0n);const ticketCalculated=original-addedTips;
 const difference=bill.ticketTotal===null?null:ticketCalculated-decimalUnits(bill.ticketTotal,2);
 const {total}=convertToUyu(unitsDecimal(String(original)),bill.currency,bill.rate);
 const weights=[...balances].filter(([,n])=>n>0n).map(([personId,n])=>({personId,input:unitsDecimal(String(n),4)}));
 const allocated=new Map(allocate(total,"units",weights).map(p=>[p.personId,p.amount]));
 const shares=[...balances.keys()].map(personId=>({personId,input:unitsDecimal(String(allocated.get(personId)??0n)),amount_minor:String(allocated.get(personId)??0n)}));
 return {bill,original,total,subtotal,discounts,charges,tips,rounding,ticketCalculated,difference,shares};
}
export function validateReconciliation(result:ReturnType<typeof calculateBill>){
 if(!result.bill.confirmed)throw Error("Confirmá la revisión de la cuenta antes de guardar.");
 if(result.difference!==null&&result.difference!==0n)throw Error("El total del ticket no coincide. Corregí los datos o agregá un redondeo explícito.");
 if(result.difference===null&&result.bill.noTotalReason.trim().length<8)throw Error("Indicá por qué no hay un total legible y confirmá el total calculado.");
}
