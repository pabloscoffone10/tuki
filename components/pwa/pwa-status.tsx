"use client";
import { useEffect,useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConnectivity } from "./connectivity";
import { useInstallState } from "./install-events";

/** Registers only the public worker; it never reads cookies, tokens or financial payloads. */
export function PwaStatus(){
 useInstallState();
 const online=useConnectivity(),router=useRouter();const [update,setUpdate]=useState(false);const [registrationError,setRegistrationError]=useState(false);
 const [wasOffline,setWasOffline]=useState(false);
 useEffect(()=>{const remember=()=>setWasOffline(true);window.addEventListener("offline",remember);return()=>window.removeEventListener("offline",remember);},[]);
 useEffect(()=>{
  if(process.env.NODE_ENV!=="production"||!window.isSecureContext||!("serviceWorker" in navigator))return;
  let disposed=false;let current:ServiceWorkerRegistration|undefined;let installing:ServiceWorker|null=null;
  const stateChanged=()=>{if(!disposed&&installing?.state==="installed"&&current?.waiting)setUpdate(true);};
  const found=()=>{installing=current?.installing??null;installing?.addEventListener("statechange",stateChanged);};
  void navigator.serviceWorker.register("/sw.js",{scope:"/",updateViaCache:"none"}).then(registration=>{
   if(disposed)return;current=registration;if(registration.waiting)setUpdate(true);registration.addEventListener("updatefound",found);found();
  }).catch(()=>{if(!disposed)setRegistrationError(true);});
  return()=>{disposed=true;current?.removeEventListener("updatefound",found);installing?.removeEventListener("statechange",stateChanged);};
 },[]);
 if(!online)return <aside role="alert" aria-label="Sin conexión" className="border-b border-amber-500/40 bg-background px-4 py-3 text-sm"><p className="font-semibold">Sin conexión detectada</p><p className="mt-1 text-xs leading-6 text-muted-foreground">Los importes que sigan visibles no están actualizados. No envíes operaciones. Tus formularios se conservan en esta ventana mientras permanezca abierta. Si un pago quedó sin respuesta, recuperá su resultado al volver.</p></aside>;
 return <>{update&&<aside role="status" className="border-b bg-background px-4 py-3 text-xs leading-6">Hay una actualización de Tuki. Terminá o recuperá las operaciones pendientes y cerrá todas las pestañas y ventanas instaladas de Tuki. Al volver a abrir se activará la versión nueva; no recargamos tus formularios automáticamente.</aside>}{registrationError&&<p role="status" className="border-b px-4 py-2 text-xs text-muted-foreground">No pudimos preparar el acceso sin conexión. La versión web sigue disponible; revisá la conexión y volvé a abrir Tuki más tarde.</p>}{wasOffline&&<aside role="status" className="flex flex-wrap items-center gap-3 border-b bg-background px-4 py-3 text-xs"><p>Volvió la conexión. Revisá cualquier pago sin resultado antes de volver a enviarlo.</p><Button size="sm" variant="outline" onClick={()=>{setWasOffline(false);router.refresh();}}>Consultar datos actuales</Button></aside>}</>;
}
