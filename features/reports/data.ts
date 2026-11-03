import "server-only";
import { requireUser } from "@/features/auth/session";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { z } from "zod";
import { cache } from "react";
import { statisticsSchema,personalStatisticsSchema,type ReportSearch } from "./types";

const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value=>{
 const parsed=new Date(`${value}T12:00:00Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;
},"Fecha inválida.");
export function reportPeriod(query:ReportSearch){
 const get=(key:string)=>{const value=query[key];if(Array.isArray(value))throw Error("Revisá el período: hay parámetros repetidos.");return value||undefined;};
 const from=get("from"),to=get("to");
 if((from&&!date.safeParse(from).success)||(to&&!date.safeParse(to).success)||from&&to&&from>to)throw Error("Ingresá un período válido: Desde no puede superar Hasta.");
 return {from:from??null,to:to??null};
}
export function reportError(error:{code?:string;message?:string}){
 if(error.code==="PGRST202"||error.code==="42P01")return "Falta aplicar la migración 013 de estadísticas y reportes.";
 if(error.message==="group_forbidden"||error.code==="42501")return "No tenés acceso activo a este grupo o reporte.";
 if(error.message?.startsWith("report_")||["22023","22007","22008","22P02"].includes(error.code??""))return "Revisá el período y los filtros del reporte.";
 return "No pudimos cargar el reporte. Volvé a intentar.";
}
export async function reportRpc<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
 await requireUser();const client=await createReadOnlyClient();const {data,error}=await client.rpc(name,args);
 if(error)throw Error(reportError(error));return data as T;
}
export async function groupStatistics(id:string,period:{from:string|null;to:string|null}){
 const result=await reportRpc("tuki_group_statistics",{p_group_id:id,p_from:period.from,p_to:period.to});
 const parsed=statisticsSchema.safeParse(result);if(!parsed.success)throw Error("El reporte recibido no tiene un formato válido. Revisá la migración 013.");return parsed.data;
}
export const personalStatistics=cache(async function personalStatistics(){
 const result=await reportRpc("tuki_personal_statistics");const parsed=personalStatisticsSchema.safeParse(result);
 if(!parsed.success)throw Error("El resumen personal no tiene un formato válido. Revisá la migración 013.");return parsed.data;
});
