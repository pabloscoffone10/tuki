import {filterReceiptFacts} from "./receipt-classification";
import {decimalUnits,unitsDecimal} from "@/features/finance/domain";
import type {Extraction} from "./extraction-schema";
import type {SmartItem,Adjustment} from "./domain";
import type {LineEvidence} from "./review-checks";
import {fixedAdjustments} from "./simple-editor";
const minor=(value:string)=>decimalUnits(value,2);
const cover=(name:string)=>/\bcubiertos?\b/i.test(name);
/** A displayed price is always the whole line amount. Quantities never multiply it again. */
export function importGroupedReceipt(data:Extraction){
 data=filterReceiptFacts(data);
 const evidence:Record<string,LineEvidence>={},doubtfulIds:string[]=[];
 const items:SmartItem[]=[];
 const compatible=new Map<string,SmartItem>();
 for(const raw of data.items){
  const quantity=raw.quantity??"1";
  const q=decimalUnits(quantity,4);
  const total=raw.subtotal??(raw.unitPrice!==null&&raw.quantity!==null?unitsDecimal(String((minor(raw.unitPrice)*q+5000n)/10000n)):"");
  if(cover(raw.name??"")&&total!==""&&minor(total)===0n)continue;
  const consistent=q>0n&&(!raw.unitPrice||!raw.quantity||total===""||(minor(raw.unitPrice)*q+5000n)/10000n===minor(total));
  const key=raw.unitPrice!==null&&raw.quantity!==null&&consistent&&total!==""?`${raw.name?.trim().toLocaleLowerCase()}:${minor(raw.unitPrice)}`:null;
  const previous=key?compatible.get(key):undefined;
  if(previous){
   const combinedQ=decimalUnits(previous.quantity,4)+q,combinedPrice=minor(previous.price)+minor(total);
   // Keep separate evidence if per-line rounding would change a merged validation.
   if((minor(raw.unitPrice!)*combinedQ+5000n)/10000n===combinedPrice){
    previous.quantity=unitsDecimal(String(combinedQ),4);previous.price=unitsDecimal(String(combinedPrice));previous.discount=unitsDecimal(String(minor(previous.discount)+minor(raw.discount??"0")));
    evidence[previous.id]={unitPrice:raw.unitPrice!,subtotal:previous.price};
    if(raw.uncertain)doubtfulIds.push(previous.id);continue;
   }
  }
  const item:SmartItem={id:crypto.randomUUID(),name:raw.name??"",quantity,priceMode:"subtotal",price:total,discount:raw.discount??"0",split:"equal",consumers:[],reviewed:!!raw.name&&total!==""};
  items.push(item);if(key)compatible.set(key,item);
  // With unknown quantity, the subtotal is sufficient. Do not invent a unit price.
  if(raw.quantity&&raw.unitPrice)evidence[item.id]={unitPrice:raw.unitPrice,subtotal:total};
  if(raw.uncertain||!consistent)doubtfulIds.push(item.id);
 }
 const converted=fixedAdjustments(items,data.adjustments.map(a=>({id:crypto.randomUUID(),label:a.label,kind:a.kind,mode:a.amount!==null?"fixed":"percent",value:a.amount??a.percent??"",subtract:a.subtract,included:a.included??false,distribution:"proportional",consumers:[],reviewed:true})) as Adjustment[]);
 const adjustments:Adjustment[]=[];
 for(const a of converted){
  if(a.kind==="service"&&cover(a.label)){
   if(items.some(item=>cover(item.name)))throw Error("Los cubiertos aparecen como producto y como cargo. Revisá el ticket para no contarlos dos veces.");
   if(a.mode!=="fixed")throw Error("Revisá el importe de los cubiertos antes de importar.");
   if(minor(a.value)>0n)items.push({id:a.id,name:a.label,quantity:"1",priceMode:"subtotal",price:a.value,discount:"0",split:"equal",consumers:[],reviewed:true});
  }else adjustments.push(a);
 }
 if(items.length>80)throw Error("El ticket supera el límite de 80 productos.");
 return {items,adjustments,evidence,doubtfulIds};
}
