import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { requireSupabaseConfig } from "@/lib/env";
// Caller has authenticated the deleted group's owner using deletion_status.
export async function finishAvatarGroupDeletion(groupId:string):Promise<boolean>{
 try{
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!key)return false;
 const service=createServiceClient(requireSupabaseConfig().url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const pending=await service.rpc("tuki_avatar_cleanup",{p_group_id:groupId,p_ack:false});if(pending.error)return pending.error.code==="PGRST202";
 if(pending.data===null)return true;
 const expected=`group/${groupId}/avatar.jpg`;if(pending.data!==expected)return false;
 const result=await service.storage.from("tuki-avatars").remove([expected]);if(result.error)return false;
 const ack=await service.rpc("tuki_avatar_cleanup",{p_group_id:groupId,p_ack:true});return !ack.error&&ack.data===null;
 }catch{return false;}
}
