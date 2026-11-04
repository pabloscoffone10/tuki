import { expect,it } from "vitest";
import { betaExpenseCurrency,unitRate } from "@/features/finance/beta-currency";
import { paymentSchema } from "@/features/payments/schemas";
it("requires UYU with exact unit rate for a new expense and preserves historical rates without floats",()=>{
 expect(betaExpenseCurrency("UYU","1.000000")).toBeNull();expect(betaExpenseCurrency("USD","40")).toContain("únicamente en UYU");expect(betaExpenseCurrency("UYU","2")).not.toBeNull();expect(betaExpenseCurrency("USD","40.125",{currency:"USD",rate:"40.125000"})).toBeNull();expect(betaExpenseCurrency("UYU","1",{currency:"USD",rate:"40"})).toContain("histórico");expect(unitRate("1e0")).toBe(false);
});
it("rejects forged foreign payment fields while preserving legacy UYU payloads and their hashes",()=>{
 const id="00000000-0000-4000-8000-000000000001",receiver="00000000-0000-4000-8000-000000000002";const p={id,payerId:id,receiverId:receiver,amount:"1250.50",date:"2026-11-03",method:"cash",note:"",reference:"",groupId:null,selected:[],confirm:"yes"};const parsed=paymentSchema.parse(p);expect(parsed).not.toHaveProperty("currency");for(const extra of [{currency:"USD"},{originalCurrency:"EUR"},{original_currency:"USD"},{rate:"40"}])expect(paymentSchema.safeParse({...p,...extra}).success).toBe(false);expect(paymentSchema.safeParse({...p,currency:"UYU",rate:"1"}).success).toBe(true);
});
