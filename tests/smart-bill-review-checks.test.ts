import {expect,it} from "vitest";
import {inspectLine,inspectReceiptDraft} from "@/features/smart-bills/review-checks";
import type {SmartBill,SmartItem} from "@/features/smart-bills/domain";
const id="00000000-0000-4000-8000-000000000001";
const item=(patch:Partial<SmartItem>={}):SmartItem=>({id,name:"Milanesa",quantity:"3",priceMode:"subtotal",price:"2040",discount:"0",split:"equal",consumers:[],reviewed:false,...patch});
const bill=(items:SmartItem[]):SmartBill=>({currency:"UYU",rate:"1",items,adjustments:[],ticketTotal:null,noTotalReason:"",confirmed:false,uploadId:null});
it("blocks an inconsistent printed unit price even when the subtotal itself reconciles",()=>{
 const input=bill([item()]);const evidence={[id]:{unitPrice:"880",subtotal:"2040"}};
 const result=inspectReceiptDraft(input,evidence,"2040");expect(result.blocked).toBe(true);expect(result.lines[0].expected).toBe(264000n);expect(result.difference).toBe(0n);
 expect(inspectReceiptDraft(input,{[id]:{unitPrice:"680",subtotal:"2040"}},"2040").blocked).toBe(false);
});
it("uses exact cents and the financial half-up rounding rule for fractional quantities",()=>{
 expect(inspectLine(item({priceMode:"unit",quantity:"0,5",price:"0,01"}),{unitPrice:"0.01",subtotal:"0.01"})).toMatchObject({subtotal:1n,net:1n,issue:""});
});
it("preserves subtotal discrepancies and never modifies the input",()=>{
 const input=bill([item({price:"5220",quantity:"1"})]);const before=JSON.stringify(input);
 const result=inspectReceiptDraft(input,{},"5320");expect(result.difference).toBe(-10000n);expect(result.blocked).toBe(true);expect(JSON.stringify(input)).toBe(before);
});
it("does not infer missing quantities and refuses invalid optional printed values",()=>{
 expect(inspectLine(item({quantity:""}))).toMatchObject({net:204000n,issue:expect.stringContaining("pendiente")});
 expect(inspectReceiptDraft(bill([item()]),{},"5.320,00").blocked).toBe(true);
});

