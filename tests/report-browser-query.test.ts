import { expect,it } from "vitest";
import { browserHref,expenseQuery,reportDate } from "@/features/reports/browser-query";
it("keeps amount filters exact in minor units and preserves all filters across pages",()=>{
 const query={q:"Cena con amigos",min:"123456789012,34",max:"999999999999,99",currency:"USD",from:"2026-02-01",to:"2026-02-28",status:"all",sort:"amount_desc"};
 const parsed=expenseQuery(query);expect(parsed.filters.min_minor).toBe("12345678901234");expect(parsed.filters.max_minor).toBe("99999999999999");expect(parsed.filters.status).toBeUndefined();
 const href=new URL(browserHref("/grupos/g",query,2,"gastos"),"https://tuki.example");expect(href.searchParams.get("min")).toBe(query.min);expect(href.searchParams.get("q")).toBe(query.q);expect(href.searchParams.get("page")).toBe("2");expect(href.searchParams.get("seccion")).toBe("gastos");
});
it("rejects malformed dates, filters, duplicate values and invalid ranges before reading data",()=>{
 for(const query of [{from:"2026-02-30"},{from:"2026-12-01",to:"2026-01-01"},{min:"3",max:"2"},{min:"1e3"},{min:"1.000,00"},{status:"confirmed"},{payer:"secret"},{q:["a","b"]},{sort:"sql"},{page:"0"}])expect(()=>expenseQuery(query)).toThrow();
 expect(()=>reportDate("2024-02-29")).not.toThrow();
});
it("has explicit default state and bounded page size independent of hostile URL keys",()=>{
 const parsed=expenseQuery({limit:"1000000",page:"5"});expect(parsed.values.page).toBe(5);expect(parsed.filters).toEqual({sort:"date_desc",status:"active"});expect(parsed.active).toEqual([]);
});
