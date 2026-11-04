"use client";
import {useState} from "react";
import type {SmartItem} from "../domain";
import type {FinancePerson} from "@/features/finance/types";
import {inputClass} from "@/features/groups/components/fields";

function counts(values:string[]){const result:Record<string,number>={};for(const value of values)if(value)result[value]=(result[value]??0)+1;return result;}
const signature=(value:Record<string,number>)=>JSON.stringify(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)));

export function UnitAssignments({item,people,onChange}:{item:SmartItem;people:FinancePerson[];onChange:(value:SmartItem["consumers"])=>void}){
 const [selection,setSelection]=useState<string[]>([]);
 // Small whole-unit tickets get a visual editor; fractional/larger quantities keep the exact numeric editor.
 if(item.split!=="units"||!/^\d{1,2}(?:[.,]0{1,4})?$/.test(item.quantity))return null;
 const quantity=Number(item.quantity.replace(",","."));
 if(quantity<1||quantity>24||item.consumers.some(person=>!/^\d{1,2}(?:[.,]0{1,4})?$/.test(person.input)))return null;
 const assigned=Object.fromEntries(item.consumers.map(person=>[person.personId,Number(person.input.replace(",","."))]));
 const fallback=item.consumers.flatMap(person=>Array.from({length:Math.min(quantity,Number(person.input.replace(",",".")))},()=>person.personId)).slice(0,quantity);
 while(fallback.length<quantity)fallback.push("");
 const slots=selection.length===quantity&&signature(counts(selection))===signature(assigned)?selection:fallback;
 return <details className="rounded-lg border border-primary/30 bg-primary/5 p-3"><summary className="cursor-pointer text-xs font-semibold">Asignar unidades una por una</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{slots.map((personId,index)=><label key={index} className="space-y-1 text-xs">Unidad {index+1}<select className={inputClass} aria-label={`Unidad ${index+1} de ${item.name}`} value={personId} onChange={event=>{
  const next=slots.map((value,position)=>position===index?event.target.value:value);setSelection(next);
  onChange(Object.entries(counts(next)).map(([personId,quantity])=>({personId,input:String(quantity)})));
 }}><option value="">Sin asignar</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div></details>;
}
