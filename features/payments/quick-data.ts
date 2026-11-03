"use server";
import { z } from "zod";
import { paymentWorkspace as load } from "./data";
export async function paymentWorkspace(groupId:string|undefined,payer:string,receiver:string){
 if(!z.uuid().safeParse(payer).success||!z.uuid().safeParse(receiver).success||(groupId&&!z.uuid().safeParse(groupId).success))return {error:"La deuda indicada no es válida."};
 try{const data=await load(groupId);return {data};}catch{return {error:"No pudimos validar el saldo o tus permisos."};}
}
