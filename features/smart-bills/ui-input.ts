import { normalizeDecimalInput } from "@/lib/decimal-input";
import type { SmartBill } from "./domain";

/** UI adapter only. It does not allocate money or change the financial domain.
 * Keep the typed draft intact and serialize only validated decimal strings. */
export function normalizeSmartBillInput(bill:SmartBill):SmartBill{
 return {...bill,rate:normalizeDecimalInput(bill.currency==="UYU"?"1":bill.rate,6),
  ticketTotal:bill.ticketTotal===null?null:normalizeDecimalInput(bill.ticketTotal,2),
  items:bill.items.map(item=>({...item,quantity:normalizeDecimalInput(item.quantity,4),price:normalizeDecimalInput(item.price,2),discount:normalizeDecimalInput(item.discount,2),consumers:item.consumers.map(person=>({...person,input:normalizeDecimalInput(person.input,4)}))})),
  adjustments:bill.adjustments.map(adjustment=>({...adjustment,value:normalizeDecimalInput(adjustment.value,adjustment.mode==="percent"?4:2),consumers:adjustment.consumers.map(person=>({...person,input:normalizeDecimalInput(person.input,adjustment.distribution==="custom"?2:4)}))})),
 };
}
