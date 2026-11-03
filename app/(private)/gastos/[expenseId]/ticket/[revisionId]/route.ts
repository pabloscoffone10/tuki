import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function GET(_request:Request,{params}:RouteContext<"/gastos/[expenseId]/ticket/[revisionId]">){
 const {expenseId,revisionId}=await params,headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox"};
 const missing=()=>new Response("Ticket no disponible.",{status:404,headers});
 if(!z.uuid().safeParse(expenseId).success||!z.uuid().safeParse(revisionId).success)return missing();
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return new Response("Iniciá sesión.",{status:401,headers});
 const {data:revision,error}=await client.from("expense_revisions").select("group_id").eq("id",revisionId).eq("expense_id",expenseId).maybeSingle();if(error||!revision)return missing();
 const {data:bill,error:billError}=await client.from("smart_bill_revisions").select("upload_id").eq("revision_id",revisionId).maybeSingle();if(billError||!bill?.upload_id)return missing();
 const {data:file,error:downloadError}=await client.storage.from("tuki-tickets").download(`${revision.group_id}/${bill.upload_id}`);if(downloadError||!file)return missing();
 if(!["image/jpeg","image/png","image/webp","application/pdf"].includes(file.type))return missing();
 return new Response(await file.arrayBuffer(),{headers:{...headers,"Content-Type":file.type,"Content-Disposition":"attachment; filename=\"ticket\""}});
}
