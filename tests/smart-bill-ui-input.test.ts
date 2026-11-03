import { expect,it } from "vitest";
import { normalizeSmartBillInput } from "@/features/smart-bills/ui-input";
import { calculateBill,type SmartBill } from "@/features/smart-bills/domain";
const a="00000000-0000-4000-8000-000000000001",b="00000000-0000-4000-8000-000000000002";
const bill=():SmartBill=>({currency:"USD",rate:"40,123456",items:[{id:a,name:"Agua",quantity:"1,5",priceMode:"unit",price:"10,10",discount:"0,15",split:"units",consumers:[{personId:a,input:"0,5"},{personId:b,input:"1"}],reviewed:true}],adjustments:[],ticketTotal:"15,00",noTotalReason:"",confirmed:true,uploadId:null});
it("normalizes Spanish decimals only at the UI boundary and preserves exact financial arithmetic",()=>{
 const draft=bill(),normalized=normalizeSmartBillInput(draft);expect(normalized.rate).toBe("40.123456");expect(normalized.items[0].price).toBe("10.10");expect(normalized.items[0].quantity).toBe("1.5");expect(normalized.items[0].consumers[0].input).toBe("0.5");expect(calculateBill(normalized).difference).toBe(0n);expect(draft.items[0].price).toBe("10,10");
});
it("rejects ambiguous thousands separators and excessive money precision without approximating",()=>{
 for(const value of ["1.000,50","1,000.50","10,123","1e3","-20","1 000"]){const draft=bill();draft.items[0].price=value;expect(()=>normalizeSmartBillInput(draft)).toThrow();}
 const draft=bill();draft.adjustments=[{id:b,label:"Propina",kind:"tip",mode:"fixed",value:"0,001",subtract:false,included:false,distribution:"equal",consumers:[{personId:a,input:"1"}],reviewed:true}];expect(()=>normalizeSmartBillInput(draft)).toThrow();
});
