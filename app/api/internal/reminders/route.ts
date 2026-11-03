import { timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
export async function POST(request:Request){
 if(process.env.TUKI_AUTOMATIC_REMINDERS_ENABLED!=="true")return Response.json({error:"disabled"},{status:503});
 const secret=process.env.TUKI_CRON_SECRET,header=request.headers.get("authorization"),provided=header?.startsWith("Bearer ")?header.slice(7):undefined;
 if(!secret||secret.length<32||!provided||Buffer.byteLength(provided)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(secret),Buffer.from(provided)))return Response.json({error:"unauthorized"},{status:401});
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return Response.json({error:"not_configured"},{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data,error}=await client.rpc("tuki_run_automatic_reminders");
 return error?Response.json({error:"reminder_run_failed"},{status:500}):Response.json({queued:data},{headers:{"Cache-Control":"no-store"}});
}
