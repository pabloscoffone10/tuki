"use server";
import sharp from "sharp";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/features/auth/session";
import { createClient } from "@/lib/supabase/server";
import { avatarPath,AVATAR_OUTPUT_BYTES } from "./domain";
const targetSchema=z.object({kind:z.enum(["profile","group"]),targetId:z.uuid()});
export async function avatarUrl(value:unknown):Promise<{url?:string}>{
 await requireUser();const target=targetSchema.safeParse(value);if(!target.success)return {};
 try{const client=await createClient();const result=await client.storage.from("tuki-avatars").createSignedUrl(avatarPath(target.data.kind,target.data.targetId),120);return result.error?{}:{url:result.data.signedUrl};}catch{return {};}
}
export async function updateAvatar(form:FormData){
 const user=await requireUser();const target=targetSchema.safeParse({kind:form.get("kind"),targetId:form.get("targetId")});if(!target.success)return {error:"Destino de imagen inválido."};
 const {kind,targetId}=target.data;if(kind==="profile"&&targetId!==user.id)return {error:"Solo podés modificar tu foto."};
 try{
 const client=await createClient();if(kind==="group"){
 const {data:person}=await client.from("persons").select("id").eq("user_id",user.id).maybeSingle();
 if(!person)return {error:"No pudimos validar tus permisos."};
 const {data:member}=await client.from("group_members").select("role,status").eq("group_id",targetId).eq("person_id",person.id).maybeSingle();
 if(member?.role!=="admin"||member.status!=="active")return {error:"Solo un administrador activo puede modificar la imagen."};
 const {data:group}=await client.from("groups").select("archived_at").eq("id",targetId).maybeSingle();if(!group||group.archived_at)return {error:"Desarchivá el grupo antes de cambiar su foto."};
 }
 const bucket=client.storage.from("tuki-avatars"),path=avatarPath(kind,targetId);
 if(form.get("remove")==="true"){const {error}=await bucket.remove([path]);if(error)return {error:"No pudimos eliminar la foto."};}
 else{
 const file=form.get("image");if(!(file instanceof File)||file.size===0||file.size>AVATAR_OUTPUT_BYTES||file.type!=="image/jpeg")return {error:"Usá una imagen JPG recortada de hasta 512 KiB."};
 const pipeline=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:16777216,animated:false});const metadata=await pipeline.metadata();if(metadata.format!=="jpeg"||!metadata.width||!metadata.height)return {error:"La imagen no es un JPG válido."};
 const image=await pipeline.rotate().resize(512,512,{fit:"cover"}).jpeg({quality:85}).toBuffer();
 const {error}=await bucket.upload(path,image,{contentType:"image/jpeg",upsert:true,cacheControl:"0"});if(error)return {error:"No pudimos guardar la foto. Revisá los permisos y la migración de imágenes."};
 }
 revalidatePath("/","layout");return {success:true};
 }catch{return {error:"No pudimos procesar la imagen. Probá con otra foto."};}
}
