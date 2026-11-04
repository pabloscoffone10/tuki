import {expect,it} from "vitest";
import {parseReceiptDocument} from "@/features/smart-bills/receipt-parser";
import {filterReceiptFacts,isReceiptMetadata} from "@/features/smart-bills/receipt-classification";
import {importGroupedReceipt} from "@/features/smart-bills/grouped-import";
import type {Extraction} from "@/features/smart-bills/extraction-schema";
const row=(name:string,subtotal="12"):Extraction["items"][number]=>({name,quantity:null,unitPrice:null,subtotal,discount:null,uncertain:false});
const data=(items:Extraction["items"]):Extraction=>({currency:"UYU",total:"5320",items,adjustments:[],warnings:[],complete:true});
it.each(["MESA: 12","MOZO: JUAN","FOLIO 42176","Btdo dia [12] Folio No 42176","6/11/2026 21:30","21:30","Comensales: 6","Terminal: 123","Autorizacion: 54321","RUT 123456789012","IVA INCLUIDO","TOTAL 5320"])("excludes administrative facts: %s",line=>expect(isReceiptMetadata(line)).toBe(true));
it("parses products, cubiertos and fixed tip without importing administrative headers or duplicate totals",()=>{
 const text="RESTAURANTE EL BODEGON\nRUT 123456789012\nDIRECCION: CALLE 123\nTELEFONO 12345678\nMONEDA UYU\nMESA: 12\nMOZO: JUAN\nCOMENSALES 6\n6/11/2026 21:30\nFOLIO 42176\nTERMINAL: 55\n3 MILANESA NAPOLITANA 500 1500\n6 CUBIERTOS 70 420\nSUBTOTAL 1920\nSUBTOTAL 1920\nPROPINA 10% 192\nIVA INCLUIDO\nTOTAL 2112\nTOTAL 2112\nEFECTIVO 2112";
 const parsed=parseReceiptDocument(text);expect(parsed.extraction.items.map(i=>i.name)).toEqual(["MILANESA NAPOLITANA","CUBIERTOS"]);expect(parsed.extraction.items[0]).toMatchObject({quantity:"3",subtotal:"1500.00"});expect(parsed.extraction.adjustments).toHaveLength(1);expect(parsed.extraction.adjustments[0]).toMatchObject({kind:"tip",amount:"192.00",percent:null});expect(parsed.extraction.total).toBe("2112.00");
});
it.each(["Mesa de quesos","Pizza de la casa","Servicio de te","Hamburguesa restaurante especial"])("preserves real priced product %s",name=>{expect(isReceiptMetadata(name)).toBe(false);expect(parseReceiptDocument(`UYU\n${name} 500\nTOTAL 500`).extraction.items[0]?.name).toBe(name);expect(filterReceiptFacts(data([row(name,"500")])).items).toHaveLength(1);});
it("locally filters false Gemini/cached products, including a restaurant header identified in source context",()=>{
 const filtered=filterReceiptFacts(data([row("MESA"),row("FOLIO"),row("IVA INCLUIDO"),row("TOTAL"),row("RESTAURANTE EL BODEGON"),row("Milanesa","500")]),"RESTAURANTE EL BODEGON\nRUT 123456789012\nMilanesa 500");expect(filtered.items.map(i=>i.name)).toEqual(["Milanesa"]);expect(filtered.warnings.length).toBeGreaterThan(0);expect(importGroupedReceipt(data([row("Mesa: 12"),row("Milanesa","500")])).items).toHaveLength(1);
});
it("keeps ambiguous merchant-like names for correction rather than deleting a possible product",()=>{const filtered=filterReceiptFacts(data([row("Restaurante especial","500")]));expect(filtered.items[0]).toMatchObject({name:"Restaurante especial",uncertain:true});});
