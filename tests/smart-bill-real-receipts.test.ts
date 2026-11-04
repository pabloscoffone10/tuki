import {expect,it} from "vitest";
import {parseReceiptDocument} from "@/features/smart-bills/receipt-parser";
import {importGroupedReceipt} from "@/features/smart-bills/grouped-import";

// Visual transcriptions from the private photos, stripped of identifying metadata.
// These verify extraction independently of the real OCR measurements below.
const tickets=[
 {name:"Guaviare",total:"1190.00",currency:"UYU",text:"MONEDA: UYU\nCUBIERTOS 120.00\n2.00 UN X 60.00\n1/2 VACIO 420.00\n1.00 UN X 420.00\nP NATURAL 110.00\n1.00 UN X 110.00\nRIÑON 220.00\n1.00 UN X 220.00\nLIMONADA 320.00\n2.00 UN X 160.00\nTOTAL 1190.00",rows:[["2.00","60.00","120.00"],["1.00","420.00","420.00"],["1.00","110.00","110.00"],["1.00","220.00","220.00"],["2.00","160.00","320.00"]]},
 {name:"Cafetería",total:"2180.00",currency:null,text:"1 180 180 EXPRESSO\n1 250 250 CAFE CON LECHE\n1 250 250 THÉ\n2 750 1500 SANDWUICHE\nN Subtotal: $ 1786.89\n| IVA: $ 393.11\nTOTAL: $ 2180.00",rows:[["1","180.00","180.00"],["1","250.00","250.00"],["1","250.00","250.00"],["2","750.00","1500.00"]]},
 {name:"Piriápolis",total:"5320.00",currency:null,text:"CUBIERTO\n6.0 x $70,00 $420,00\nMILANESA NAPOLITANA C/ GUARNICIÓN\n3.0 x $680,00 $2040,00\nMILANESA A CABALLO C/ FRITAS\n3.0 x $520,00 $1560,00\nMILANESA C/ GUARNICIÓN $450,00\nAGUA SALUS GRANDE $250,00\nREFRESCO GRANDE\n2.0 x $300,00 $600,00\n16 Artículos TOTAL $5.320,00\nImpuestos incluidos Base Cuota\nIVA 22% $4.360,66 $959,34",rows:[["6.0","70.00","420.00"],["3.0","680.00","2040.00"],["3.0","520.00","1560.00"],[null,null,"450.00"],[null,null,"250.00"],["2.0","300.00","600.00"]]},
 {name:"Bacar",total:"1525.00",currency:"UYU",text:"AROCENA 1644\nMONEDA: UYU\nJUGO DE NARANJA 268.00\n2.00 UN X 134.00\nFILET DE LOMO C/GUARNICION 670.00\n1.00 UN X 670.00\nMILANESA PASIVA DE CARNE 587.00\n1.00 UN X 587.00\nTOTAL: 1,525.00",rows:[["2.00","134.00","268.00"],["1.00","670.00","670.00"],["1.00","587.00","587.00"]]},
];
it.each(tickets)("extracts the visually verified $name rows without duplicated IVA",ticket=>{
 const {extraction,analysis}=parseReceiptDocument(ticket.text);
 expect(extraction.total).toBe(ticket.total);expect(extraction.currency).toBe(ticket.currency);
 expect(extraction.items.map(i=>[i.quantity,i.unitPrice,i.subtotal])).toEqual(ticket.rows);
 expect(analysis.totals.itemsSum).toBe(ticket.total);expect(analysis.totals.totalDifference).toBe("0.00");expect(extraction.adjustments).toEqual([]);
 const imported=importGroupedReceipt(extraction);expect(imported.items).toHaveLength(ticket.rows.length);
 expect(imported.items.every(i=>i.consumers.length===0&&i.split==="equal"&&i.priceMode==="subtotal")).toBe(true);
 if(ticket.name==="Cafetería")expect(analysis.totals.subtotal).toBeNull();
});
it("preserves the actual Piriápolis misread total and warns instead of inventing a balancing adjustment",()=>{
 const {extraction,analysis}=parseReceiptDocument(tickets[2].text.replace("$5.320,00","Y 0.320,00"));
 expect(extraction.total).toBe("0320.00");expect(analysis.totals.totalDifference).toBe("5000.00");expect(analysis.issues.join(" ")).toContain("diferencia");expect(extraction.items).toHaveLength(6);expect(extraction.adjustments).toEqual([]);
});
it("does not convert fiscal data returned by Gemini into assignable products",()=>{
 const data=parseReceiptDocument(tickets[0].text).extraction;
 data.items.push({name:"IVA incluido 22%",quantity:"1",unitPrice:"100",subtotal:"100",discount:null,uncertain:false});
 expect(importGroupedReceipt(data).items).toHaveLength(5);
});
it("makes service a product and keeps tips assignable equally with nobody selected",()=>{
 const data=parseReceiptDocument(tickets[0].text).extraction;
 data.adjustments=[{kind:"service",label:"Servicio",amount:"50",percent:null,included:true,subtract:false},{kind:"tip",label:"Propina",amount:"100",percent:null,included:false,subtract:false}];
 const imported=importGroupedReceipt(data);
 expect(imported.items.at(-1)).toMatchObject({name:"Servicio",price:"50.00",split:"equal",consumers:[]});
 expect(imported.adjustments[0]).toMatchObject({kind:"tip",included:false,distribution:"equal",consumers:[]});
});

import captures from "./fixtures/receipts/ocr-captures.json";
it.each(captures.map((capture,index)=>({capture,index})))("replays actual Tesseract photo output $capture.file",({capture,index})=>{
 const parsed=parseReceiptDocument(capture.text,capture.lines);
 expect(parsed.extraction.items).toHaveLength([5,4,6,3,7][index]);
 expect(parsed.analysis.totals.itemsSum).toBe(["1190.00","2180.00","5320.00","1525.00","60.20"][index]);
 expect(parsed.extraction.total).toBe([null,null,"0320.00","1525.00",null][index]);
 expect(parsed.extraction.adjustments).toEqual([]);
});
