// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { beforeEach,expect,it,vi } from "vitest";

type WorkerRequest={url:string;method:string;headers:Headers;mode:string;destination:string};
type WorkerEvent={request?:WorkerRequest;waitUntil?:(work:Promise<unknown>)=>void;respondWith?:(work:Promise<Response>)=>void};
let handlers:Record<string,(event:WorkerEvent)=>void>,fetcher:ReturnType<typeof vi.fn>,claim:ReturnType<typeof vi.fn>,stores:Map<string,Map<string,Response>>;
const origin="https://tuki.example";
const key=(value:string|WorkerRequest)=>typeof value==="string"?new URL(value,origin).href:value.url;
const publicResponse=(body="asset",type="text/javascript",policy="public, max-age=31536000, immutable")=>new Response(body,{headers:{"content-type":type,"cache-control":policy}});
beforeEach(()=>{
 handlers={};stores=new Map();fetcher=vi.fn(async()=>publicResponse());claim=vi.fn(async()=>{});
 const cacheApi={open:async(name:string)=>{
  if(!stores.has(name))stores.set(name,new Map());const entries=stores.get(name)!;
  return{match:async(request:string|WorkerRequest)=>entries.get(key(request))?.clone(),put:async(request:string|WorkerRequest,response:Response)=>{entries.set(key(request),response.clone());},delete:async(request:string|WorkerRequest)=>entries.delete(key(request))};
 },keys:async()=>[...stores.keys()],delete:async(name:string)=>stores.delete(name)};
 runInNewContext(readFileSync("public/sw.js","utf8"),{self:{location:{origin},clients:{claim},addEventListener:(name:string,fn:(event:WorkerEvent)=>void)=>{handlers[name]=fn;}},caches:cacheApi,fetch:fetcher,URL,Response,Set,Promise});
});
function request(path:string,options:Partial<Omit<WorkerRequest,"url">>={}):WorkerRequest{return{url:new URL(path,origin).href,method:"GET",mode:"cors",destination:"",headers:new Headers(),...options};}
async function lifecycle(name:string){let pending:Promise<unknown>|undefined;handlers[name]({waitUntil:work=>{pending=work;}});await pending;}
async function handle(req:WorkerRequest){let response:Promise<Response>|undefined;handlers.fetch({request:req,respondWith:work=>{response=work;}});return response?await response:undefined;}

it("installs only the public recovery page and approved PNG icons without credentials",async()=>{
 fetcher.mockImplementation(async(path:string)=>publicResponse("public",path.endsWith(".png")?"image/png":"text/html","public, max-age=0"));await lifecycle("install");
 expect(stores.get("tuki-public-v1")?.size).toBe(5);expect(fetcher).toHaveBeenCalledWith("/offline.html",{credentials:"omit",cache:"reload"});expect(handlers.message).toBeUndefined();expect(handlers.sync).toBeUndefined();
});
it("refuses installation when the fallback forbids persistent caching",async()=>{
 fetcher.mockResolvedValue(publicResponse("private","text/html","private, no-store"));await expect(lifecycle("install")).rejects.toThrow("not cacheable");expect(stores.get("tuki-public-v1")?.size).toBe(0);
});
it("never intercepts mutation, Supabase, auth, RSC, prefetch, export or private receipt requests",async()=>{
 const paths=[request("/pagos",{method:"POST"}),request("https://project.supabase.co/rest/v1/payments"),request("/auth/callback"),request("/api/internal/reminders"),request("/grupos/id?_rsc=hash"),request("/grupos/id",{headers:new Headers({RSC:"1"})}),request("/grupos/id",{headers:new Headers({"Next-Router-Prefetch":"1"})}),request("/grupos/id",{headers:new Headers({"Next-Router-Segment-Prefetch":"/_tree"})}),request("/",{headers:new Headers({"Next-Action":"action"})}),request("/grupos/id/exportar"),request("/gastos/id/comprobante/r"),request("/gastos/id/ticket/r"),request("/private",{headers:new Headers({Authorization:"Bearer token"})})];
 for(const req of paths)expect(await handle(req)).toBeUndefined();expect(fetcher).not.toHaveBeenCalled();expect(stores.size).toBe(0);
});
it("fetches full private documents from network every time and never stores them",async()=>{
 fetcher.mockImplementation(async()=>new Response("private account",{headers:{"cache-control":"private, no-store"}}));const req=request("/pagos",{mode:"navigate",destination:"document"});expect(await(await handle(req))?.text()).toBe("private account");expect(await(await handle(req))?.text()).toBe("private account");expect(fetcher).toHaveBeenCalledTimes(2);expect(stores.size).toBe(0);
});
it("uses only the public recovery page on failed full-document navigation, not server errors",async()=>{
 stores.set("tuki-public-v1",new Map([[key("/offline.html"),publicResponse("public offline","text/html","public")]]));fetcher.mockRejectedValueOnce(Error("offline"));expect(await(await handle(request("/grupos/id",{mode:"navigate",destination:"document"})))?.text()).toBe("public offline");fetcher.mockResolvedValueOnce(new Response("forbidden",{status:403}));expect((await handle(request("/grupos/id",{mode:"navigate",destination:"document"})))?.status).toBe(403);expect(stores.get("tuki-public-v1")?.size).toBe(1);
});
it("recovers ordinary filtered document URLs offline without storing their query or HTML",async()=>{
 stores.set("tuki-public-v1",new Map([[key("/offline.html"),publicResponse("public offline","text/html","public")]]));fetcher.mockRejectedValueOnce(Error("offline"));expect(await(await handle(request("/grupos/id?seccion=gastos",{mode:"navigate",destination:"document"})))?.text()).toBe("public offline");expect(stores.get("tuki-public-v1")?.size).toBe(1);expect(await handle(request("/_next/static/chunks/hash.js?v=1"))).toBeUndefined();
});
it("revalidates unversioned public icons and removes old copies if caching is later forbidden",async()=>{
 const req=request("/icons/icon-192.png");fetcher.mockResolvedValueOnce(publicResponse("old","image/png","public, max-age=0"));await handle(req);fetcher.mockResolvedValueOnce(publicResponse("new","image/png","public, max-age=0"));expect(await(await handle(req))?.text()).toBe("new");expect(fetcher).toHaveBeenCalledTimes(2);fetcher.mockRejectedValueOnce(Error("offline"));expect(await(await handle(req))?.text()).toBe("new");fetcher.mockResolvedValueOnce(publicResponse("forbidden","image/png","private, no-store"));await handle(req);expect(stores.get("tuki-public-v1")?.has(key(req))).toBe(false);
});
it("caches immutable public static files and reuses only those assets",async()=>{
 const req=request("/_next/static/chunks/hash.js");expect(await(await handle(req))?.text()).toBe("asset");expect(await(await handle(req))?.text()).toBe("asset");expect(fetcher).toHaveBeenCalledTimes(1);expect(stores.get("tuki-public-v1")?.size).toBe(1);
});
it("does not store responses with private, no-store, cookie variance, wrong content or missing immutable",async()=>{
 for(const [index,response] of [publicResponse("private","text/javascript","private, immutable"),publicResponse("no","text/javascript","public, no-store, immutable"),publicResponse("html","text/html"),publicResponse("rsc","text/x-component"),publicResponse("dynamic","text/javascript","public, max-age=0"),new Response("vary",{headers:{"content-type":"text/javascript","cache-control":"public, immutable","vary":"Cookie"}})].entries()){
  fetcher.mockResolvedValueOnce(response);await handle(request(`/_next/static/chunks/${index}.js`));
 }expect(stores.get("tuki-public-v1")?.size).toBe(0);
});
it("activation deletes only obsolete Tuki public caches and never reloads clients",async()=>{
 stores.set("tuki-public-v0",new Map());stores.set("tuki-public-v1",new Map());stores.set("another-app",new Map());await lifecycle("activate");expect([...stores.keys()]).toEqual(["tuki-public-v1","another-app"]);expect(claim).toHaveBeenCalledTimes(1);
});
