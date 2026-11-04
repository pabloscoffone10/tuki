import {expect,it} from "vitest";
import {expandReceiptItem,fixedAdjustments} from "@/features/smart-bills/simple-editor";
import {calculateBill,validateReconciliation,type SmartBill,type SmartItem} from "@/features/smart-bills/domain";
import {parseReceiptText} from "@/features/smart-bills/receipt-parser";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const item:SmartItem={id:a,name:"Milanesa",quantity:"3",priceMode:"subtotal",price:"2040",discount:"0",split:"equal",consumers:[],reviewed:false};
const bill=(items:SmartItem[]):SmartBill=>({currency:"UYU",rate:"1",items,adjustments:[],ticketTotal:"2040",confirmed:true,noTotalReason:"",uploadId:null});
it("expands known units, assigns different diners and shares a single unit exactly",()=>{
 const units=expandReceiptItem(item,{unitPrice:"680",subtotal:"2040"});expect(units).toHaveLength(3);expect(new Set(units.map(i=>i.id)).size).toBe(3);
 units[0].consumers=[{personId:a,input:"1"}];units[1].consumers=[{personId:b,input:"1"}];units[2].consumers=[{personId:a,input:"1"},{personId:b,input:"1"}];
 const result=calculateBill(bill(units));expect(result.total).toBe(204000n);expect(result.shares.map(s=>s.amount_minor)).toEqual(["102000","102000"]);expect(()=>validateReconciliation(result)).not.toThrow();
});
it("does not invent unit prices from subtotal or accept contradictory values",()=>{
 expect(expandReceiptItem(item)).toEqual([{...item,reviewed:false}]);expect(expandReceiptItem(item,{unitPrice:"880",subtotal:"2040"})).toHaveLength(1);
 expect(expandReceiptItem({...item,quantity:"1"},{unitPrice:"680",subtotal:"2040"})[0].reviewed).toBe(false);
});
it("preserves every cent when spreading an existing item discount",()=>{
 const units=expandReceiptItem({...item,discount:"0.02"},{unitPrice:"680",subtotal:"2040"});expect(units.map(i=>i.discount)).toEqual(["0.01","0.01","0.00"]);
});
it("turns percentages into fixed amounts using the financial rounding rules",()=>{
 const units=expandReceiptItem(item,{unitPrice:"680",subtotal:"2040"}).map(i=>({...i,consumers:[{personId:a,input:"1"}]}));
 const adjustments=fixedAdjustments(units,[{id:b,label:"Propina",kind:"tip",mode:"percent",value:"10",subtract:false,included:false,distribution:"equal",consumers:[{personId:a,input:"1"}],reviewed:true}]);expect(adjustments[0]).toMatchObject({mode:"fixed",value:"204.00"});
 const result=calculateBill({...bill(units),adjustments});expect(result.total).toBe(224400n);expect(result.difference).toBe(0n);
});
it("blocks unassigned products, invalid prices and unreconciled expenses",()=>{
 const units=expandReceiptItem(item,{unitPrice:"680",subtotal:"2040"});expect(()=>calculateBill(bill(units))).toThrow();
 const assigned=units.map(i=>({...i,consumers:[{personId:a,input:"1"}]}));expect(()=>calculateBill(bill(assigned.map(i=>({...i,price:"invalid"}))))).toThrow();
 expect(()=>validateReconciliation(calculateBill({...bill(assigned),ticketTotal:"2000"}))).toThrow(/no coincide/);
});
it("excludes the real folio regression and administrative headers without losing food",()=>{
 const result=parseReceiptText("UYU\nBtdo dia [12] Folio No 42176\nMesa 12\nMesero Pablo 123\nFactura 5252\nRUT 123456789012\nMilanesa 3 x 680 2040\nTOTAL 2040\nEFECTIVO 2040");
 expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({name:"Milanesa",subtotal:"2040.00"});
});
