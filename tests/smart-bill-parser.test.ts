import {expect,it} from "vitest";
import {parseReceiptAmount,parseReceiptText,parseReceiptDocument} from "@/features/smart-bills/receipt-parser";
import {extractionSchema} from "@/features/smart-bills/extraction-schema";

it.each([["1.234,56","1234.56"],["1234,56","1234.56"],["50.00","50.00"],["1.234",null],["12,3",null],["1O0,00",null]])("normalizes only unambiguous amounts %s",(input,expected)=>{
 expect(parseReceiptAmount(input!)).toBe(expected);
});
it("reads Uruguay products and quantities without inventing missing data",()=>{
 const result=parseReceiptText("MONEDA UYU\nAgua 2 x 50,00 100,00\nPan 1.234,56\nTOTAL A PAGAR $ 1.334,56\nEFECTIVO 2.000,00\nVUELTO 665,44");
 expect(result.items).toEqual([
  {name:"Agua",quantity:"2",unitPrice:"50.00",subtotal:"100.00",discount:null,uncertain:true},
  {name:"Pan",quantity:null,unitPrice:null,subtotal:"1234.56",discount:null,uncertain:true},
 ]);
 expect(result.total).toBe("1334.56");expect(result.currency).toBe("UYU");expect(extractionSchema.safeParse(result).success).toBe(true);
});
it("supports explicit prefix quantities and a separate quantity/unit-price line",()=>{
 const result=parseReceiptText("2 x Agua 50,00 100,00\n0,500 x 200,00\nQueso 100,00\nTOTAL 200,00");
 expect(result.items[0]).toMatchObject({name:"Agua",quantity:"2",unitPrice:"50.00",subtotal:"100.00"});
 expect(result.items[1]).toMatchObject({name:"Queso",quantity:"0.500",unitPrice:"200.00",subtotal:"100.00"});
});
it("does not mistake taxes, discounts, payments or subtotals for products",()=>{
 const result=parseReceiptText("RUT 123456789012\nIVA 22,00\nSUBTOTAL 100,00\nAgua 100,00\nDESCUENTO -10,00\nPROPINA 5,00\nTOTAL 95,00\nVISA 95,00");
 expect(result.items).toHaveLength(1);expect(result.adjustments.map(a=>a.kind)).toEqual(["discount","tip"]);expect(result.warnings.join(" ")).toContain("manualmente");
});
it("preserves repeated purchases, refuses conflicting totals and does not infer currency from $",()=>{
 const result=parseReceiptText("Agua 50,00\nAgua 50,00\nTOTAL $ 100,00\nTOTAL $ 150,00");
 expect(result.items).toHaveLength(2);expect(result.total).toBeNull();expect(result.currency).toBeNull();expect(result.complete).toBe(false);
});
it("keeps unreadable prices missing and limits extracted products",()=>{
 const unreadable=parseReceiptDocument("Agua 1O0,OO\nTOTAL ilegible");
 expect(unreadable.extraction.items[0].subtotal).toBeNull();expect(unreadable.analysis.items[0].suggestions).toContainEqual(expect.objectContaining({field:"subtotal",value:"100.00"}));
 const result=parseReceiptText(Array.from({length:100},()=>"Agua 1,00").join("\n"));
 expect(result.items).toHaveLength(80);expect(result.total).toBeNull();expect(extractionSchema.safeParse(result).success).toBe(true);
});

it.each([["$1.250,50","1250.50"],["$1,250.50","1250.50"],["$1250","1250.00"],["$1.450","1450.00"]])("supports explicit international monetary formats %s",(input,expected)=>{
 expect(parseReceiptAmount(input)).toBe(expected);
});

const ticketA=`Restaurante de prueba
FECHA 03/11/2026
Agua 1 litro: $180
Guacamole $450
Refresco $150
Plato de guarnición $280
Tacos $780
Filete de res $1.450
Camarones $1.600
Pastel $280
Helado $220
Botella Moët & Chandon $12.000
Set Mesa $250
Subtotal impreso: $17.700.
Propina: $2.655.
Total a pagar: $20.355.
Subtotal impreso: $17.700.
Propina: $2.655.
Total a pagar: $20.355.`;
it("regresses ticket A: preserves all 11 real lines, deduplicates totals and exposes the actual discrepancy",()=>{
 const {extraction,analysis}=parseReceiptDocument(ticketA);
 expect(extraction.items).toHaveLength(11);expect(extraction.items.find(item=>item.name?.includes("Chandon"))?.subtotal).toBe("12000.00");
 expect(extraction.total).toBe("20355.00");expect(extraction.adjustments).toHaveLength(1);expect(extraction.adjustments[0]).toMatchObject({kind:"tip",amount:"2655.00",included:true});
 expect(analysis.totals).toEqual({subtotal:"17700.00",itemsSum:"17640.00",subtotalDifference:"-60.00",calculatedTotal:"20295.00",totalDifference:"-60.00"});
 expect(analysis.blocked).toBe(true);expect(analysis.date).toBe("2026-11-03");expect(analysis.merchant).toBe("Restaurante de prueba");
 expect(extraction.items.every(item=>item.quantity===null)).toBe(true);expect(extractionSchema.safeParse(extraction).success).toBe(true);
});
const ticketB=`UYU
Cubierto: 6 × $70 = $420
Milanesa napolitana: 3 × $680 = $2.040
Milanesa a caballo: 3 × $520 = $1.560
Milanesa con guarnición: $450
Agua Salus grande: $250
Refresco grande: 2 × $300 = $600
Total: $5.320.
IVA 22% incluido.`;
it("regresses ticket B with exact cent arithmetic and no double-counting included IVA",()=>{
 const {extraction,analysis}=parseReceiptDocument(ticketB);
 expect(extraction.items).toHaveLength(6);expect(extraction.items[1]).toMatchObject({name:"Milanesa napolitana",quantity:"3",unitPrice:"680.00",subtotal:"2040.00"});
 expect(analysis.totals).toMatchObject({itemsSum:"5320.00",totalDifference:"0.00"});expect(extraction.adjustments).toEqual([]);expect(analysis.blocked).toBe(false);
});
it("flags ticket B OCR mutations and suggests alternatives without overwriting printed evidence",()=>{
 const {extraction,analysis}=parseReceiptDocument(ticketB.replace("$680","$880").replace("= $600","= $500").replace("$5.320","$5.420"));
 expect(extraction.items[1]).toMatchObject({unitPrice:"880.00",subtotal:"2040.00"});
 expect(analysis.items[1].suggestions).toContainEqual(expect.objectContaining({field:"unitPrice",value:"680.00"}));
 expect(extraction.items[5].subtotal).toBe("500.00");expect(analysis.items[5].suggestions).toContainEqual(expect.objectContaining({field:"subtotal",value:"600.00"}));
 expect(extraction.total).toBe("5420.00");expect(analysis.totals.totalDifference).toBe("-200.00");expect(analysis.blocked).toBe(true);
});
it("associates multiline names and quantity-price details printed below a product",()=>{
 const {extraction}=parseReceiptDocument("MILANESA\nNAPOLITANA\n3.0 x $680,00 = $2.040,00\nRefresco grande 600,00\n2 x 300 = 600\nTOTAL $2.640,00");
 expect(extraction.items).toHaveLength(2);expect(extraction.items[0]).toMatchObject({name:"MILANESA NAPOLITANA",quantity:"3.0",unitPrice:"680.00",subtotal:"2040.00"});
 expect(extraction.items[1]).toMatchObject({name:"Refresco grande",quantity:"2",unitPrice:"300.00",subtotal:"600.00"});
});
it("uses positional evidence to associate disjoint columns and exposes field confidence",()=>{
 const {extraction,analysis}=parseReceiptDocument("Agua 2 50,00 100,00\nTOTAL 100,00",[
  {text:"100,00",confidence:95,bbox:{x0:400,y0:10,x1:480,y1:30}},
  {text:"Agua",confidence:95,bbox:{x0:10,y0:10,x1:100,y1:30}},
  {text:"2 50,00",confidence:92,bbox:{x0:200,y0:10,x1:300,y1:30}},
  {text:"TOTAL 100,00",confidence:96,bbox:{x0:10,y0:50,x1:480,y1:70}},
 ]);
 expect(extraction.items[0]).toMatchObject({name:"Agua",quantity:"2",unitPrice:"50.00",subtotal:"100.00"});expect(analysis.items[0].sourceLines).toHaveLength(3);
 expect(analysis.items[0].fields).toEqual({name:"high",quantity:"high",unitPrice:"high",subtotal:"high"});
});
it("keeps mixed currencies unknown and requires review of OCR substitutions instead of silently repairing them",()=>{
 const {extraction,analysis}=parseReceiptDocument("UYU USD\nAgua 2 x $5O,00 = $100,00\nTOTAL $100,00");
 expect(extraction.currency).toBeNull();expect(extraction.items[0].unitPrice).toBeNull();expect(analysis.items[0].suggestions).toContainEqual(expect.objectContaining({field:"unitPrice",value:"50.00"}));
});
it("extracts explicit additional tax but never converts a negative product into a positive purchase",()=>{
 const {extraction}=parseReceiptDocument("Agua 100,00\nDevolución -10,00\nIVA adicional 22,00\nTOTAL 122,00");
 expect(extraction.items).toHaveLength(1);expect(extraction.adjustments[0]).toMatchObject({kind:"service",amount:"22.00"});
});
it("does not accept impossible dates or promote a weak total using unrelated high confidence text",()=>{
 const {analysis}=parseReceiptDocument("FECHA 31/02/2026\nAgua 100,00\nTOTAL 100,00",[
  {text:"FECHA 31/02/2026",confidence:95},
  {text:"Agua 100,00",confidence:95},
  {text:"TOTAL 100,00",confidence:30},
 ]);
 expect(analysis.date).toBeNull();expect(analysis.totalConfidence).toBe("review");
});
it("handles explicit percentage tips with exact rounding and no invented fixed amount",()=>{
 const {extraction,analysis}=parseReceiptDocument("Agua 100,00\nPropina 15%\nTOTAL 115,00");
 expect(extraction.adjustments[0]).toMatchObject({kind:"tip",amount:null,percent:"15.00",included:true});expect(analysis.totals.totalDifference).toBe("0.00");
});
it("preserves real repeated charges before the total while deduplicating a repeated summary",()=>{
 const {extraction,analysis}=parseReceiptDocument("Agua 100,00\nDescuento 5,00\nDescuento 5,00\nTOTAL 90,00\nDescuento 5,00\nTOTAL 90,00");
 expect(extraction.adjustments).toHaveLength(2);expect(analysis.totals.totalDifference).toBe("0.00");
});

it("reads Uruguayan thermal totals with repeated decimal marks without changing digits",()=>{
 expect(parseReceiptAmount("5.320.00")).toBe("5320.00");expect(parseReceiptAmount("1.525.00")).toBe("1525.00");expect(parseReceiptAmount("5.32000")).toBeNull();
});
it("accepts MONEDA semicolon and attached UN details without turning RUT into a product",()=>{
 const result=parseReceiptText("BACAR S.A 211430680013\nMONEDA; UYU\nJugo 268.00\n2.00UN X 134.00\nTOTAL 268.00");
 expect(result.items).toHaveLength(1);expect(result.items[0]).toMatchObject({quantity:"2.00",unitPrice:"134.00",subtotal:"268.00"});
});
