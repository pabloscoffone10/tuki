import {decimalUnits,unitsDecimal} from "@/features/finance/domain";
import type {SmartItem,Adjustment} from "./domain";
import type {LineEvidence} from "./review-checks";
import {normalizeDecimalInput} from "@/lib/decimal-input";
const money=(value:string)=>decimalUnits(normalizeDecimalInput(value,2),2);
/** Only expand verified whole units. Never infer a unit price from a subtotal. */
export function expandReceiptItem(item:SmartItem,evidence?:LineEvidence):SmartItem[]{
 try{
  const quantity=decimalUnits(normalizeDecimalInput(item.quantity,4),4);
  if(quantity===10000n){const consistent=!(item.priceMode==="subtotal"&&evidence?.unitPrice&&money(evidence.unitPrice)!==money(item.price));return [{...item,quantity:"1",reviewed:!!item.name&&!!item.price&&consistent}];}
  if(quantity<=10000n||quantity%10000n||quantity>800000n)return [item];
  const unit=item.priceMode==="unit"?money(item.price):evidence?.unitPrice?money(evidence.unitPrice):null;
  const total=item.priceMode==="subtotal"?money(item.price):unit!*quantity/10000n;
  if(unit===null||unit*quantity/10000n!==total)return [{...item,reviewed:false}];
  const count=Number(quantity/10000n),discount=money(item.discount);
  return Array.from({length:count},(_,index)=>({...item,id:crypto.randomUUID(),name:`${item.name.slice(0,110)} ${index+1}`,quantity:"1",priceMode:"unit",price:unitsDecimal(String(unit)),discount:unitsDecimal(String(discount/BigInt(count)+(BigInt(index)<discount%BigInt(count)?1n:0n))),split:"equal",consumers:[],reviewed:true}));
 }catch{return [{...item,reviewed:false}];}
}
/** Match the domain's sequential percentage rounding, without requiring assignments. */
export function fixedAdjustments(items:SmartItem[],adjustments:Adjustment[]):Adjustment[]{
 let base=0n;
 try{for(const item of items){const price=money(item.price),q=decimalUnits(normalizeDecimalInput(item.quantity,4),4);base+=(item.priceMode==="unit"?(price*q+5000n)/10000n:price)-money(item.discount);}}catch{return adjustments;}
 try{return adjustments.map(a=>{const amount=a.mode==="fixed"?money(a.value):(base*decimalUnits(normalizeDecimalInput(a.value,4),4)+500000n)/1000000n;base+=a.kind==="discount"||(a.kind==="rounding"&&a.subtract)?-amount:amount;return {...a,mode:"fixed",value:unitsDecimal(String(amount))};});}catch{return adjustments;}
}
