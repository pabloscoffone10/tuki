import { finishAvatarGroupDeletion } from "@/features/avatars/deletion-storage";
import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireSupabaseConfig } from "@/lib/env";

// SQL commits first. The durable queue survives API failures and lost responses.
// Authenticate the deleted group's owner before using the server-only key.
export async function finishGroupFileDeletion(groupId:string):Promise<boolean>{
 try {
  const client=await createClient();
  const status=await client.rpc("tuki_group_deletion_status",{p_group_id:groupId});
  if(status.error||typeof status.data!=="number")return false;
  if(status.data===0)return true;
  if(!await finishAvatarGroupDeletion(groupId))return false;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)return false;
  const service=createServiceClient(requireSupabaseConfig().url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let removed:string[]=[];
  for(let batch=0;batch<5;batch++){
   const {data,error}=await service.rpc("tuki_group_file_cleanup",{p_group_id:groupId,p_removed:removed});
   if(error||!data||!Array.isArray(data.paths))return false;
   if(data.remaining===0)return true;
   const paths=data.paths as string[];
   if(!paths.length||paths.some(path=>typeof path!=="string"||!path.startsWith(`${groupId}/`)))return false;
   const result=await service.storage.from("tuki-tickets").remove(paths);
   if(result.error)return false;
   removed=paths;
  }
  const last=await service.rpc("tuki_group_file_cleanup",{p_group_id:groupId,p_removed:removed});
  return !last.error&&last.data?.remaining===0;
 }catch{return false;}
}
