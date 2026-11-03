// @vitest-environment node
import { expect,it } from "vitest";
import { validateDeploymentEnvironment } from "@/lib/deployment";

const approved = {
  NEXT_PUBLIC_SUPABASE_URL: "https://staging-db.example",
  TUKI_STAGING_SUPABASE_ORIGIN: "https://staging-db.example/",
  TUKI_PRODUCTION_SUPABASE_ORIGIN: "https://production-db.example",
  TUKI_SITE_URL: "https://preview-tuki.example",
};
it("blocks a secret or service-role key before any local or deployed build can inline it",()=>{
 const payload=(role:string)=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role})).toString("base64url")}.fixture-signature`;
 for(const key of ["sb_secret_private-test-value",payload("service_role"),payload("authenticated"),"eyJinvalid.payload.signature"]){
  expect(()=>validateDeploymentEnvironment({NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key})).toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
 }
 expect(()=>validateDeploymentEnvironment({NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:payload("anon")})).not.toThrow();
 expect(()=>validateDeploymentEnvironment({NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:"sb_publishable_local-test"})).not.toThrow();
});
it("does not change ordinary local builds or Vercel development",()=>{
  expect(()=>validateDeploymentEnvironment({})).not.toThrow();
  expect(()=>validateDeploymentEnvironment({VERCEL_ENV:"development",NEXT_PUBLIC_SUPABASE_URL:"http://localhost:54321"})).not.toThrow();
});
it("accepts Preview only for its approved staging origin with a different production project",()=>{
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview"})).not.toThrow();
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",NEXT_PUBLIC_SUPABASE_URL:approved.TUKI_PRODUCTION_SUPABASE_ORIGIN})).toThrow("Preview requiere");
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",TUKI_STAGING_SUPABASE_ORIGIN:approved.TUKI_PRODUCTION_SUPABASE_ORIGIN})).toThrow("distintos");
});
it("fails closed when Preview lacks an owner-approved environment allowlist",()=>{
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",TUKI_STAGING_SUPABASE_ORIGIN:undefined})).toThrow("TUKI_STAGING_SUPABASE_ORIGIN");
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",TUKI_PRODUCTION_SUPABASE_ORIGIN:undefined})).toThrow("TUKI_PRODUCTION_SUPABASE_ORIGIN");
});
it("accepts Production only for its approved database and rejects a duplicated staging origin",()=>{
  const production={...approved,VERCEL_ENV:"production",NEXT_PUBLIC_SUPABASE_URL:approved.TUKI_PRODUCTION_SUPABASE_ORIGIN,TUKI_SITE_URL:"https://tuki.example"};
  expect(()=>validateDeploymentEnvironment(production)).not.toThrow();
  expect(()=>validateDeploymentEnvironment({...production,NEXT_PUBLIC_SUPABASE_URL:approved.NEXT_PUBLIC_SUPABASE_URL})).toThrow("Production requiere");
  expect(()=>validateDeploymentEnvironment({...production,TUKI_STAGING_SUPABASE_ORIGIN:approved.TUKI_PRODUCTION_SUPABASE_ORIGIN})).toThrow("distintos");
});
it.each(["http://preview.example","https://preview.example/callback","https://preview.example?token=private-token","https://user:private-password@preview.example","https://localhost"])("rejects unsafe deployed site configuration without echoing its value",value=>{
  let message="";try{validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",TUKI_SITE_URL:value});}catch(error){message=(error as Error).message;}
  expect(message).toContain("TUKI_SITE_URL");expect(message).not.toContain(value);expect(message).not.toMatch(/private-token|private-password/);
});
it("rejects path-shaped and credential-bearing Supabase origins rather than normalizing away the mistake",()=>{
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",NEXT_PUBLIC_SUPABASE_URL:"https://staging-db.example/rest/v1"})).toThrow("NEXT_PUBLIC_SUPABASE_URL");
  expect(()=>validateDeploymentEnvironment({...approved,VERCEL_ENV:"preview",TUKI_PRODUCTION_SUPABASE_ORIGIN:"https://private-user:private-password@production-db.example"})).toThrow("TUKI_PRODUCTION_SUPABASE_ORIGIN");
});
