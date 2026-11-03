/** Product gate for new beta operations. Historical arithmetic remains in domain.ts. */
export const BETA_CURRENCY = "UYU" as const;
export const BETA_CURRENCY_MESSAGE = "Durante la beta, los gastos y pagos nuevos son únicamente en UYU, sin conversión.";
export function unitRate(value:unknown){return typeof value==="string"&&/^1(?:\.0{1,6})?$/.test(value);}
export function betaExpenseCurrency(currency:string,rate:string,previous?:{currency:string;rate:string}){
 if(previous){
  // Numeric rate comparison is exact at six decimal places; never use floats.
  const fixed=(s:string)=>{if(!/^\d+(?:\.\d{1,6})?$/.test(s))return null;const [n,d=""]=s.split(".");return BigInt(n)*1000000n+BigInt(d.padEnd(6,"0"));};
  if(currency!==previous.currency||fixed(rate)===null||fixed(rate)!==fixed(previous.rate))return "La moneda y la cotización de este gasto histórico deben conservarse. No se convierte ni se reescribe su historial.";
  return null;
 }
 return currency===BETA_CURRENCY&&unitRate(rate)?null:BETA_CURRENCY_MESSAGE;
}
