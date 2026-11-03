// @vitest-environment node
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { expect,it,vi } from "vitest";
vi.mock("@/lib/supabase/proxy",()=>({updateSession:vi.fn()}));
import manifest from "@/app/manifest";
import nextConfig from "@/next.config";
import { config } from "@/proxy";
it("provides stable standalone identity, root scope and real PNG icons including a safe maskable mark",async()=>{
 const data=manifest();expect(data).toMatchObject({id:"/",name:"Tuki",short_name:"Tuki",start_url:"/",scope:"/",display:"standalone"});
 for(const icon of data.icons??[]){const meta=await sharp(`public${icon.src}`).metadata();expect(`${meta.width}x${meta.height}`).toBe(icon.sizes);expect(meta.format).toBe("png");}
 const apple=await sharp("public/icons/apple-touch-icon.png").metadata();expect(apple.width).toBe(180);
 const corner=await sharp("public/icons/maskable-512.png").extract({left:0,top:0,width:1,height:1}).raw().toBuffer();expect([...corner.slice(0,3)]).toEqual([37,99,75]);
});
it("serves PWA public assets without session refresh while protecting application routes",()=>{
 const matcher=new RegExp(`^${config.matcher[0]}$`);
 for(const path of ["/sw.js","/offline.html","/manifest.webmanifest","/icons/icon-192.png","/_next/static/chunk.js"])expect(matcher.test(path)).toBe(false);
 for(const path of ["/","/grupos","/grupos/private/exportar","/pagos","/auth/callback","/notificaciones"])expect(matcher.test(path)).toBe(true);
});
it("keeps worker revalidated and permits only public offline caching without broad HTML cache policy",async()=>{
 const headers=await nextConfig.headers!();const sw=headers.find(item=>item.source==="/sw.js")!;expect(sw.headers).toContainEqual({key:"Cache-Control",value:"no-cache, no-store, must-revalidate"});const fallback=headers.find(item=>item.source==="/offline.html")!;expect(fallback.headers.find(h=>h.key==="Content-Security-Policy")?.value).toContain("default-src 'none'");
 const shared=headers.find(item=>item.source==="/:path*")!;expect(shared.headers.some(h=>h.key==="Cache-Control")).toBe(false);expect(shared.headers).toContainEqual({key:"X-Frame-Options",value:"DENY"});
 const offline=readFileSync("public/offline.html","utf8");expect(offline).not.toMatch(/<script|localStorage|indexedDB/);expect(offline).toContain("recuperá esa operación");
});
