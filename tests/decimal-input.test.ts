import { expect,it } from "vitest";
import { normalizeDecimalInput } from "@/lib/decimal-input";
it("normalizes comma or dot without converting or rounding financial strings",()=>{
 expect(normalizeDecimalInput("125,50",2)).toBe("125.50");expect(normalizeDecimalInput(" 1000.01 ",2)).toBe("1000.01");expect(normalizeDecimalInput("0,000001",6)).toBe("0.000001");expect(normalizeDecimalInput("9007199254740993,01",2)).toBe("9007199254740993.01");
});
it("rejects ambiguous thousands, mixed separators, signs, exponents and excess precision",()=>{
 for(const raw of ["1.000,50","1,000.50","1 000","1.000.000","1,000","-1","+1","1e3","", ".5","1,", "125,501"]){expect(()=>normalizeDecimalInput(raw,2),raw).toThrow();}
 expect(()=>normalizeDecimalInput("1",7)).toThrow();
});
