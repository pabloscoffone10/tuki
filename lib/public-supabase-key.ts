/** Classification only, never authentication or JWT signature verification. */
export function isPublicSupabaseKey(value:string){
 const key=value.trim();if(!key||key.startsWith("sb_secret_"))return false;
 const parts=key.split(".");
 if(parts.length===3){
  try{const payload=JSON.parse(atob(parts[1].replace(/-/g,"+").replace(/_/g,"/")));return payload!==null&&typeof payload==="object"&&payload.role==="anon";}catch{return false;}
 }
 // Publishable keys and opaque local fixtures do not carry legacy JWT roles.
 return !key.startsWith("eyJ");
}
