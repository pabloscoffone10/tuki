"use client";
import { useId,useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { addGuest } from "../actions";
import type { Member,ReusableGuest } from "../types";
import { ActionForm } from "./action-form";
import { inputClass } from "./fields";

const normalized=(value:string)=>value.normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g," ").toLocaleLowerCase("es");
function oneEditApart(first:string,second:string){
 if(Math.abs(first.length-second.length)>1)return false;
 let i=0,j=0,edits=0;
 while(i<first.length&&j<second.length){if(first[i]===second[j]){i++;j++;continue;}if(++edits>1)return false;if(first.length>=second.length)i++;if(second.length>=first.length)j++;}
 return edits+(i<first.length||j<second.length?1:0)<=1;
}
const similar=(name:string,query:string)=>{
 const value=normalized(name);
 if(query.length===1)return value===query;
 return value.includes(query)||query.includes(value)||(query.length>=4&&oneEditApart(value,query));
};

/** Suggestions are limited to the authorized server props already loaded for
 * this group. No global search, account claiming or identity mutation by name. */
export function AddParticipantForm({groupId,userId,people,members}:{groupId:string;userId:string;people:ReusableGuest[];members:Member[]}){
 const searchId=useId(),helpId=useId();
 const [query,setQuery]=useState(""),[choice,setChoice]=useState<"existing"|"new"|null>(null),[selected,setSelected]=useState(""),[distinct,setDistinct]=useState(false),[feedback,setFeedback]=useState("");
 const search=normalized(query),ready=search.length>0;
 const existing=people.filter(p=>p.user_id===null&&p.merged_into===null&&p.created_by===userId&&!members.some(m=>m.person_id===p.id));
 const suggested=ready?existing.filter(p=>similar(p.display_name,search)):[];
 const present=ready?members.filter(m=>m.person&&similar(m.person.display_name,search)):[];
 const matches=suggested.length+present.length;
 const person=existing.find(p=>p.id===selected);
 return <div className="space-y-4"><div className="space-y-2"><label htmlFor={searchId} className="block text-sm font-medium">Buscá a la persona por nombre</label><input id={searchId} className={inputClass} maxLength={80} value={query} placeholder="Escribí el nombre de la persona" aria-describedby={helpId} autoComplete="off" onChange={e=>{setQuery(e.target.value);setChoice(null);setSelected("");setDistinct(false);setFeedback("");}}/><p id={helpId} className="text-xs leading-6 text-muted-foreground">Primero revisamos participantes de este grupo e invitados que creaste y podés reutilizar. Un nombre parecido no significa que sea la misma persona.</p></div>{feedback&&<p role="status" className="rounded-lg border border-primary/30 p-3 text-sm">{feedback}</p>}
  {ready&&<div className="space-y-3" aria-live="polite">{matches>0?<p className="text-sm font-medium">Encontramos nombres iguales o parecidos. Elegí la identidad correcta.</p>:<p className="text-sm text-muted-foreground">No hay coincidencias entre las personas que podés consultar.</p>}
   {present.map(member=><div key={member.person_id} className="space-y-2 rounded-lg border bg-muted/30 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{member.person!.display_name}</strong><Badge>{member.person!.user_id?"Con cuenta":"Invitado existente"}</Badge></div><p className="text-xs text-muted-foreground">Ya tiene participación en este grupo{member.status==="retired"?" (retirado)":member.status==="invited"?" (invitado pendiente)":""}. Revisá su participación antes de agregarlo nuevamente.</p></div>)}
   {suggested.map(candidate=>{const groups=[...new Set(candidate.memberships.flatMap(m=>m.group?[m.group.name]:[]))];return <div key={candidate.id} className={`space-y-2 rounded-lg border p-3 ${selected===candidate.id?"border-primary bg-primary/5":""}`}><div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{candidate.display_name}</strong><Badge>Invitado existente</Badge></div><p className="text-xs leading-6 text-muted-foreground">{groups.length?`Lo conocés de: ${groups.join(", ")}`:"Invitado que creaste"} · Identidad {candidate.id.slice(0,8)}</p><Button type="button" size="sm" variant={selected===candidate.id?"default":"outline"} onClick={()=>{setChoice("existing");setSelected(candidate.id);setDistinct(false);}}>Usar a {candidate.display_name}</Button></div>;})}
   <Button type="button" variant="outline" onClick={()=>{setChoice("new");setSelected("");setDistinct(false);}}>Crear un invitado nuevo llamado {query.trim()}</Button>
  </div>}
  {choice==="existing"&&person&&<ActionForm key={`existing:${person.id}`} action={addGuest} label="Agregar esta persona al grupo"><input type="hidden" name="groupId" value={groupId}/><input type="hidden" name="mode" value="existing"/><input type="hidden" name="personId" value={person.id}/><input type="hidden" name="name" value=""/><p className="rounded-lg border border-primary/30 p-3 text-sm leading-6">Vas a agregar a <strong>{person.display_name}</strong> conservando su identidad global. Sus otros grupos y su historial no cambian.</p></ActionForm>}
  {choice==="new"&&ready&&<ActionForm key={`new:${query}`} action={async(state,form)=>{if(matches&&!distinct)return {error:"Confirmá que es otra persona antes de crear una identidad nueva."};const result=await addGuest(state,form);if(result.success){setFeedback(result.success);setChoice(null);setDistinct(false);}return result;}} label="Crear y agregar invitado"><input type="hidden" name="groupId" value={groupId}/><input type="hidden" name="mode" value="new"/><input type="hidden" name="personId" value=""/><input type="hidden" name="name" value={query.trim()}/><p className="text-sm leading-6">Se creará una identidad nueva para <strong>{query.trim()}</strong>, sin cuenta. No se combinará con ninguna persona existente.</p>{matches>0&&<label className="flex min-h-11 items-start gap-3 rounded-lg border border-amber-500/40 p-3 text-sm leading-6"><input className="mt-1" type="checkbox" required checked={distinct} onChange={e=>setDistinct(e.target.checked)}/>Revisé las coincidencias y confirmo que es otra persona.</label>}</ActionForm>}
  <p className="border-t pt-4 text-xs leading-6 text-muted-foreground">¿Tiene cuenta en Tuki? <Link className="font-medium text-primary underline" href={`/grupos/${groupId}?seccion=ajustes`}>Generá una invitación desde Ajustes</Link>. No se vinculan cuentas por nombre.</p>
 </div>;
}
