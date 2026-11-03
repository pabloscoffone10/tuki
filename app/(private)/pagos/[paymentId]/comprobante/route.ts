import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
export async function GET(_request:Request,{params}:RouteContext<"/pagos/[paymentId]/comprobante">){
 const {paymentId}=await params,headers={"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff","Content-Security-Policy":"sandbox","Referrer-Policy":"no-referrer"};
 if(!z.uuid().safeParse(paymentId).success)return new Response("Comprobante no disponible.",{status:404,headers});
 const client=await createClient();const {data:{user},error:authError}=await client.auth.getUser();if(authError||!user)return new Response("Iniciá sesión.",{status:401,headers});
 const {data,error}=await client.from("payments").select("receipt_data,receipt_mime").eq("id",paymentId).maybeSingle();
 if(error||!data?.receipt_data||!["image/png","image/jpeg","application/pdf"].includes(data.receipt_mime))return new Response("Comprobante no disponible.",{status:404,headers});
 const extension=data.receipt_mime==="application/pdf"?"pdf":data.receipt_mime==="image/png"?"png":"jpg";
 return new Response(Buffer.from(String(data.receipt_data).replace(/^\\x/,""),"hex"),{headers:{...headers,"Content-Type":data.receipt_mime,"Content-Disposition":`attachment; filename="pago.${extension}"`}});
}
