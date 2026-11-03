import { expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("@/features/auth/session",()=>({requireUser:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createReadOnlyClient:vi.fn()}));
import { reportPeriod,reportError } from "@/features/reports/data";
it("validates exact calendar periods and rejects repeated or reversed dates",()=>{
 expect(reportPeriod({from:"2024-02-29",to:"2026-11-03"})).toEqual({from:"2024-02-29",to:"2026-11-03"});expect(()=>reportPeriod({from:"2026-02-29"})).toThrow();expect(()=>reportPeriod({from:["2026-01-01","2026-02-01"]})).toThrow();expect(()=>reportPeriod({from:"2026-11-03",to:"2026-11-02"})).toThrow();
});
it("identifies missing report migration and never echoes unsafe database errors",()=>{
 expect(reportError({code:"PGRST202"})).toContain("013");expect(reportError({message:"group_forbidden"})).toContain("acceso activo");expect(reportError({message:"secret payload token"})).not.toContain("secret");
});
