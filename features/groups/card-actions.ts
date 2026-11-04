"use server";
import { z } from "zod";
import { getGroup } from "./data";
export type CardMember={id:string;name:string;kind:"registered"|"guest"|"restricted";status:string;admin:boolean};
export async function groupCardMembers(groupId:string):Promise<{members?:CardMember[];error?:string}>{
 if(!z.uuid().safeParse(groupId).success)return {error:"El grupo no es válido."};
 try{const result=await getGroup(groupId,{people:false,invitations:false,events:false});
 if(!result.group)return {error:"No pudimos consultar los miembros de este grupo."};
 return {members:result.members.map(m=>({id:m.person_id,name:m.person?.display_name??"Identidad restringida",kind:!m.person?"restricted":m.person.user_id?"registered":"guest",status:m.status,admin:m.role==="admin"}))};
 }catch{return {error:"No pudimos cargar los miembros. Intentá nuevamente."};}
}
