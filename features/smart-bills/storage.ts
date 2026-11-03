import { TicketError } from "./errors";
import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { validateTicket } from "./files";
export async function uploadTicket(file:File,groupId:string,expenseId:string,version:number){
 await requireUser(); z.uuid().parse(groupId);
 const validated=await validateTicket(file),client=await createClient();
 // Same expense/version/file gets the same reservation on a network retry.
 const digest=createHash("sha256").update(`${expenseId}:${version}:`).update(validated.bytes).digest();digest[6]=(digest[6]&15)|64;digest[8]=(digest[8]&63)|128;
 const hex=digest.subarray(0,16).toString("hex"),id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
 const {data:path,error}=await client.rpc("tuki_reserve_ticket",{p_id:id,p_group_id:groupId,p_mime:validated.mime,p_size:file.size});
 if(error||typeof path!=="string")throw new TicketError("No pudimos reservar el comprobante. Revisá la migración 006 y el límite de 10 archivos por día.");
 const {error:storageError}=await client.storage.from("tuki-tickets").upload(path,validated.bytes,{contentType:validated.mime,upsert:false});
 if(storageError){
  const {data:existing}=await client.storage.from("tuki-tickets").download(path);
  if(!existing||!Buffer.from(await existing.arrayBuffer()).equals(validated.bytes))throw new TicketError("No pudimos subir el ticket al almacenamiento privado. Revisá el bucket y sus políticas.");
 }
 return {id,path,client};
}
