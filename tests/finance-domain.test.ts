import { describe, expect, it } from "vitest";
import { allocate, convertToUyu, decimalUnits, netPairs, type Obligation } from "@/features/finance/domain";
const people = ["a", "b", "c"].map((personId) => ({ personId, input: "1" }));
describe("exact financial arithmetic", () => {
 it("rounds deterministic remainders by global identity", () => {
  expect(allocate(100n, "equal", [...people].reverse()).sort((a,b)=>a.personId.localeCompare(b.personId)).map(x=>x.amount)).toEqual([34n,33n,33n]);
 });
 it("converts once with exact half-up and ignores FX for UYU", () => {
  expect(convertToUyu("0.01","USD","40.5").total).toBe(41n);
  expect(convertToUyu("123.45","UYU","99").total).toBe(12345n);
  expect(convertToUyu("100","BRL","7.123456").total).toBe(71235n);
 });
 it("validates precision, positivity and bounded amounts", () => {
  for(const bad of ["1,00","1e3","-1","1.001","NaN"]) expect(()=>decimalUnits(bad,2)).toThrow();
  expect(()=>convertToUyu("0","UYU","1")).toThrow();
 });
 it("checks percentages and custom totals without tolerance", () => {
  expect(()=>allocate(100n,"percent",people)).toThrow();
  expect(allocate(100n,"percent",[{personId:"a",input:"33.3333"},{personId:"b",input:"66.6667"}]).map(x=>x.amount)).toEqual([33n,67n]);
  expect(allocate(101n,"custom",[{personId:"a",input:"0.01"},{personId:"b",input:"1"}]).map(x=>x.amount)).toEqual([1n,100n]);
  expect(()=>allocate(100n,"custom",people)).toThrow();
 });
 it("allocates weighted units and rejects duplicates or zero units", () => {
  expect(allocate(101n,"units",[{personId:"a",input:"1"},{personId:"b",input:"3"}]).map(x=>x.amount)).toEqual([25n,76n]);
  expect(()=>allocate(100n,"equal",[people[0],people[0]])).toThrow();
  expect(()=>allocate(100n,"units",[{personId:"a",input:"0"}])).toThrow();
 });
 it("nets inverse pairs only, deduplicates projections, keeps triangles",()=>{
  const make=(id:string,d:string,c:string,n:string):Obligation=>({id,debtor_id:d,creditor_id:c,amount_minor:n,origin_group_id:"g",origin_group_name:"g",debtor_name:d,creditor_name:c});
  const first=make("1","a","b","100");
  const result=netPairs([first,first,make("2","b","a","30"),make("3","b","c","70"),make("4","c","a","70")]);
  expect(result).toHaveLength(3);
  expect(result.map(x=>x.amount)).toEqual([70n,70n,70n]);
 });
});
