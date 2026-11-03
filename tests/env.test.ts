import { describe, expect, it } from "vitest";
import { readSupabaseConfig } from "@/lib/env";
describe("configuración pública de Supabase", () => {
  it("detecta configuración ausente sin validarla al importar el módulo", () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "" })).toBeNull();
  });
  it("rechaza configuración parcial y URL inválida", () => {
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co" })).toBeNull();
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key" })).toBeNull();
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "file:///etc", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key" })).toBeNull();
  });
  it("acepta configuración pública completa", () => {
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key" })).toEqual({ url: "https://example.supabase.co", publishableKey: "test-public-key" });
  });
  it.each(["https://example.supabase.co/rest/v1", "https://example.supabase.co/auth/v1", "https://example.supabase.co/?apikey=private", "https://user:private@example.supabase.co"])("rechaza endpoints o credenciales incrustadas: %s", (url) => {
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "test-public-key" })).toBeNull();
  });
  it("rechaza una clave secreta en la variable pública", () => {
    expect(readSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_test" })).toBeNull();
  });
  it("rejects legacy privileged JWTs and malformed JWTs without echoing their values",()=>{
   const jwt=(role:string)=>`${btoa(JSON.stringify({alg:"HS256"}))}.${btoa(JSON.stringify({role}))}.synthetic`;
   for(const key of [jwt("service_role"),jwt("authenticated"),jwt("postgres"),"eyJ.invalid.jwt"]){expect(readSupabaseConfig({NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key})).toBeNull();}
   expect(readSupabaseConfig({NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:jwt("anon")})).not.toBeNull();
  });
});
