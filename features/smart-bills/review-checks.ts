import {decimalUnits} from "@/features/finance/domain";
import {normalizeDecimalInput} from "@/lib/decimal-input";
import type {SmartBill,SmartItem} from "./domain";

export type LineEvidence={unitPrice:string;subtotal:string};
const exact=(value:string,places:number)=>decimalUnits(normalizeDecimalInput(value,places),places);
export function inspectLine(item:SmartItem,evidence?:LineEvidence){
 let subtotal:bigint|null=null,expected:bigint|null=null,issue="";
 try{
  const quantity=exact(item.quantity,4);
  if(quantity<=0n)throw Error();
  const price=exact(item.price,2);
  subtotal=item.priceMode==="subtotal"?price:(quantity*price+5000n)/10000n;
  const unit=item.priceMode==="unit"?item.price:evidence?.unitPrice;
  const printed=item.priceMode==="subtotal"?item.price:evidence?.subtotal;
  if(unit&&printed){
   expected=(quantity*exact(unit,2)+5000n)/10000n;
   if(expected!==exact(printed,2))issue="Cantidad × precio unitario no coincide con el importe de la línea. Revisá ambos valores con la foto.";
  }
  const discount=exact(item.discount,2);
  if(discount>subtotal)throw Error();
  return {subtotal,net:subtotal-discount,expected,issue};
 }catch{return {subtotal,net:null,expected,issue:issue||"Completá cantidad, precio y descuento con valores válidos."};}
}
export function inspectReceiptDraft(bill:SmartBill,evidence:Record<string,LineEvidence>,printedSubtotal:string){
 const lines=bill.items.map(item=>({id:item.id,...inspectLine(item,evidence[item.id])}));
 const sum=lines.length&&lines.every(line=>line.net!==null)?lines.reduce((total,line)=>total+line.net!,0n):null;
 let difference:bigint|null=null,subtotalInvalid=false;
 if(printedSubtotal){try{if(sum!==null)difference=sum-exact(printedSubtotal,2);}catch{subtotalInvalid=true;}}
 return {lines,sum,difference,subtotalInvalid,blocked:lines.some(line=>!!line.issue)||subtotalInvalid||(difference!==null&&difference!==0n)};
}
