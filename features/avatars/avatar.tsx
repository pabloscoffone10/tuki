"use client";
import { useEffect,useState } from "react";
import { UserRound,UsersRound } from "lucide-react";
import { avatarUrl } from "./actions";
import type { AvatarKind } from "./domain";
export function Avatar({kind,targetId,name}:{kind:AvatarKind;targetId:string;name:string}){
 const [url,setUrl]=useState<string>();
 useEffect(()=>{let active=true;const load=()=>{void avatarUrl({kind,targetId}).then(result=>{if(active)setUrl(result.url);}).catch(()=>{if(active)setUrl(undefined);});};load();const timer=setInterval(load,90000);const changed=()=>load();window.addEventListener("tuki-avatar-changed",changed);return()=>{active=false;clearInterval(timer);window.removeEventListener("tuki-avatar-changed",changed);};},[kind,targetId]);
 return <span className="inline-flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-primary/10 bg-primary/5 text-primary">{url?
 // eslint-disable-next-line @next/next/no-img-element -- Authenticated, short-lived Storage URL.
 <img src={url} alt={`Foto de ${name}`} className="size-full object-cover" onError={()=>setUrl(undefined)}/>:kind==="group"?<UsersRound className="size-5" aria-label={name}/>:<UserRound className="size-5" aria-label={name}/>}</span>;
}
