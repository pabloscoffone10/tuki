/** Only structural receipt labels are excluded; words inside product names are harmless. */
export function isReceiptMetadata(value:string){
 const text=value.trim().replace(/\s+/g," ");
 return /^(?:mesa|comensales|personas|pax)\s*(?::|#|n[\u00ba\u00b0o.]*)?\s*\d+\s*$/i.test(text)
  || /^(?:mesa|comensales|mozo|mesero|camarero|vendedor|folio|factura|ticket|rut|ruc|fecha|hora|terminal|autorizaci[oó]n)$/i.test(text)
  || /^(?:mozo|mesero|camarero|vendedor)\s*:\s*.+$/i.test(text)
  || /^(?:folio|factura|ticket|terminal|autorizaci[oó]n|c[oó]digo de autorizaci[oó]n)\s*(?::|#|n[\u00ba\u00b0o.]*)?\s*[\d-]+\s*$/i.test(text)
  || /\bfolio\s+n[\u00ba\u00b0o.]*\s*\d+\s*$/i.test(text)
  || /^(?:rut|ruc|raz[oó]n social|direcci[oó]n|domicilio|tel[eé]fono|tel\.?|fecha|hora)\s*[:#]?\s+.+$/i.test(text)
  || /^(?:\d{1,2}[/-]){2}\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/.test(text)
  || /^\d{1,2}:\d{2}(?::\d{2})?$/.test(text)
  || /^(?:sub\s*total|total(?: a pagar)?|iva incluido|impuestos? incluidos?|efectivo|tarjeta|visa|mastercard|vuelto|cambio)(?:\s*[:$]?\s*[\d., ]+)?$/i.test(text)
  || /^(?:gracias por (?:su|tu) (?:compra|visita)|vuelva pronto|comprobante no fiscal)[.!\s]*$/i.test(text);
}

import type {Extraction} from "./extraction-schema";
/** Apply the same conservative guard to model responses and recovered scans. */
export function filterReceiptFacts(data:Extraction,text=""):Extraction{
 const headerLines=text.split(/\r?\n/).slice(0,8).map(line=>line.trim().toLocaleLowerCase());
 const removed:string[]=[];
 const items=data.items.flatMap(item=>{
  const name=item.name?.trim()??"";
  const merchant=/^(?:restaurante|supermercado|bar)\s+\D+$/i.test(name);
  if(isReceiptMetadata(name)||(merchant&&headerLines.some((line,index)=>line===name.toLocaleLowerCase()&&(isReceiptMetadata(headerLines[index+1]??"")||/^(?:moneda\s+)?UYU$/i.test(headerLines[index+1]??""))))){removed.push(name);return [];}
  return [{...item,uncertain:item.uncertain||merchant}];
 });
 return {...data,items,warnings:[...data.warnings,...(removed.length?["Se omitieron datos informativos del ticket. Revisá los productos y el total."]:[])].slice(0,20)};
}
