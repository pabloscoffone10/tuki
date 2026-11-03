import { normalizeDecimalInput } from "@/lib/decimal-input";

export type BrowserSearch = Record<string, string | string[] | undefined>;
export type ExpenseQuery = {
 q: string; from: string; to: string; payer: string; participant: string;
 currency: string; min: string; max: string; status: string; category: string; sort: string; page: number;
};
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function singleQuery(query: BrowserSearch, name: string): string {
 const value = query[name];
 if (Array.isArray(value)) throw new Error("Cada filtro debe aparecer una sola vez.");
 return value ?? "";
}
export function reportDate(value: string) {
 if (!value) return "";
 if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new Error("Revisá las fechas del período.");
 return value;
}
export function reportPage(value: string) {
 if (!value) return 1;
 if (!/^[1-9]\d{0,5}$/.test(value) || Number(value)>100000) throw new Error("La página solicitada no es válida.");
 return Number(value);
}
function minor(value: string) {
 const normalized=normalizeDecimalInput(value,2);
 const [whole,fraction=""]=normalized.split(".");
 const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,"0"));
 if(result>100000000000000n)throw new Error("El importe del filtro está fuera de rango.");
 return result.toString();
}
export function expenseQuery(query: BrowserSearch): {values: ExpenseQuery; filters: Record<string,string>; active: [string,string][]} {
 const values:ExpenseQuery={q:singleQuery(query,"q").trim(),from:reportDate(singleQuery(query,"from")),to:reportDate(singleQuery(query,"to")),payer:singleQuery(query,"payer"),participant:singleQuery(query,"participant"),currency:singleQuery(query,"currency"),min:singleQuery(query,"min"),max:singleQuery(query,"max"),status:singleQuery(query,"status")||"active",category:singleQuery(query,"category"),sort:singleQuery(query,"sort")||"date_desc",page:reportPage(singleQuery(query,"page"))};
 if(values.q.length>120)throw new Error("La búsqueda admite hasta 120 caracteres.");
 if(values.from&&values.to&&values.from>values.to)throw new Error("La fecha inicial debe ser anterior a la final.");
 for(const id of [values.payer,values.participant])if(id&&!uuid.test(id))throw new Error("Revisá el pagador o participante seleccionado.");
 if(values.currency&&!["UYU","USD","ARS","BRL","EUR","GBP","CHF","CAD","AUD"].includes(values.currency))throw new Error("Seleccioná una moneda compatible.");
 if(!["active","void","all"].includes(values.status))throw new Error("Seleccioná un estado válido.");
 if(values.category&&!["food","travel","home","sports","other"].includes(values.category))throw new Error("Seleccioná una categoría válida.");
 if(!["date_desc","date_asc","amount_desc","amount_asc"].includes(values.sort))throw new Error("Seleccioná un orden válido.");
 const filters:Record<string,string>={sort:values.sort};
 for(const key of ["q","from","to","payer","participant","currency","category"] as const)if(values[key])filters[key]=values[key];
 if(values.status!=="all")filters.status=values.status;
 if(values.min)filters.min_minor=minor(values.min);
 if(values.max)filters.max_minor=minor(values.max);
 if(filters.min_minor&&filters.max_minor&&BigInt(filters.min_minor)>BigInt(filters.max_minor))throw new Error("El importe mínimo no puede superar al máximo.");
 const labels:Record<string,string>={q:"Descripción",from:"Desde",to:"Hasta",payer:"Pagador",participant:"Participante",currency:"Moneda",min:"Mínimo UYU",max:"Máximo UYU",status:"Estado",category:"Categoría",sort:"Orden"};
 const active=Object.entries(values).filter(([key,value])=>key!=="page"&&value&&!(key==="status"&&value==="active")&&!(key==="sort"&&value==="date_desc")).map(([key,value])=>[labels[key],String(value)] as [string,string]);
 return {values,filters,active};
}
export function browserHref(path:string, query:BrowserSearch, page:number, section?:string) {
 const params=new URLSearchParams();
 for(const [key,value] of Object.entries(query))if(typeof value==="string"&&value&&key!=="page"&&key!=="seccion")params.set(key,value);
 if(section)params.set("seccion",section);
 if(page>1)params.set("page",String(page));
 return `${path}${params.size?`?${params}`:""}`;
}
