import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function GET(_request:Request,{params}:RouteContext<"/gastos/[expenseId]/comprobante/[revisionId]">){
 const {expenseId,revisionId}=await params;const headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox","Referrer-Policy":"no-referrer"};
 if(!z.uuid().safeParse(expenseId).success||!z.uuid().safeParse(revisionId).success)return new Response("No encontrado",{status:404,headers});
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return new Response("Iniciá sesión para descargar el comprobante.",{status:401,headers});
 const {data,error}=await client.from("expense_revisions").select("receipt_data,receipt_mime").eq("id",revisionId).eq("expense_id",expenseId).maybeSingle();
 if(error||!data?.receipt_data)return new Response("Comprobante no disponible.",{status:404,headers});
 const mime=String(data.receipt_mime);if(!["application/pdf","image/png","image/jpeg"].includes(mime))return new Response("Comprobante no disponible.",{status:404,headers});
 const bytes=Buffer.from(String(data.receipt_data).replace(/^\\x/,""),"hex");const extension=mime==="application/pdf"?"pdf":mime==="image/png"?"png":"jpg";
 return new Response(bytes,{headers:{...headers,"Content-Type":mime,"Content-Disposition":`attachment; filename="comprobante.${extension}"`}});
}
