"use client";
import { useId,useState } from "react";
import { ActionForm } from "@/features/groups/components/action-form";
import { Field,inputClass } from "@/features/groups/components/fields";
import { Button } from "@/components/ui/button";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { saveExpense } from "../actions";
import { allocate,convertToUyu,formatUyu,unitsDecimal,type SplitMethod } from "../domain";
import type { ExpenseDetail,FinancePerson } from "../types";

export function ExpenseForm({id,groupId,people,initial,currentPersonId,prefill}:{id:string;groupId:string;people:FinancePerson[];initial?:ExpenseDetail;currentPersonId?:string;prefill?:{title:string;amount:string}}){
 const errorId=useId();
 const oldIds=new Set(initial?.shares.map(s=>s.personId));if(initial)oldIds.add(initial.payer_id);
 const available=people.filter(p=>!p.replaced&&(p.status==="active"||(p.status==="retired"&&oldIds.has(p.id))));
 const defaultPayer=available.some(p=>p.id===currentPersonId&&p.status==="active")?currentPersonId:"";
 const [title,setTitle]=useState(initial?.title??prefill?.title??""),[notes,setNotes]=useState(initial?.notes??""),[category,setCategory]=useState(initial?.category??"other"),[date,setDate]=useState(initial?.date??new Date().toLocaleDateString("en-CA",{timeZone:"America/Montevideo"}));
 const [amount,setAmount]=useState(initial?unitsDecimal(initial.original_minor):prefill?.amount??"");
 const currency=initial?.currency??"UYU",rate=initial?.rate??"1";
 const [payer,setPayer]=useState(initial?.payer_id??defaultPayer??""),[method,setMethod]=useState<SplitMethod>(initial?.method??"equal");
 // New expenses never silently include every member. Existing revisions retain
 // their recorded participants, including authorized historical members.
 const [selected,setSelected]=useState<string[]>(initial?.shares.map(s=>s.personId)??[]);
 const [inputs,setInputs]=useState<Record<string,string>>(()=>Object.fromEntries(initial?.shares.map(s=>[s.personId,initial.method==="equal"?"1":unitsDecimal(s.input_value,initial.method==="custom"?2:4)])??[]));
 const [reviewed,setReviewed]=useState(false);
 let canonicalAmount=amount,canonicalRate=currency==="UYU"?"1":rate;
 let shares=selected.map(personId=>({personId,input:inputs[personId]??"1"}));
 let preview:{personId:string;amount:bigint}[]=[];let total:bigint|undefined;let error="";
 try{
  canonicalAmount=normalizeDecimalInput(amount,2);canonicalRate=normalizeDecimalInput(canonicalRate,6);
  shares=shares.map(s=>({...s,input:method==="equal"?"1":normalizeDecimalInput(s.input,method==="custom"?2:4)}));
  total=convertToUyu(canonicalAmount,currency,canonicalRate).total;
  if(!shares.length)throw new Error("Seleccioná al menos una persona que comparta este gasto.");
  preview=allocate(total,method,shares);
 }catch(e){error=e instanceof Error?e.message:"Revisá el reparto.";}
 return <ActionForm action={async(state,form)=>{
  if(error)return {error};
  if(!reviewed)return {error:"Revisá las personas y el reparto antes de guardar."};
  return saveExpense(state,form);
 }} label={initial?"Guardar nueva versión":"Crear gasto"}>
  <input type="hidden" name="id" value={id}/><input type="hidden" name="groupId" value={groupId}/><input type="hidden" name="version" value={initial?.version??0}/><input type="hidden" name="shares" value={JSON.stringify(shares)}/><input type="hidden" name="amount" value={canonicalAmount}/><input type="hidden" name="rate" value={canonicalRate}/><input type="hidden" name="currency" value={currency}/>
  <Field label="Descripción"><input className={inputClass} name="title" required maxLength={120} placeholder="Por ejemplo, cancha de pádel" value={title} onChange={e=>setTitle(e.target.value)}/></Field>
  <div className="grid gap-4 sm:grid-cols-2"><Field label={`Importe en ${currency}`}><input className={inputClass} inputMode="decimal" placeholder="1000 o 1000,50" required value={amount} aria-describedby={errorId} aria-invalid={!!amount&&!!error} onChange={e=>{setAmount(e.target.value);setReviewed(false);}}/></Field><Field label="Pagó"><select className={inputClass} name="payerId" value={payer} onChange={e=>{setPayer(e.target.value);setReviewed(false);}} required><option value="">Seleccioná quién pagó</option>{available.map(p=><option key={p.id} value={p.id}>{p.name}{p.id===currentPersonId?" (vos)":""}{p.status==="retired"?" (histórico)":""}</option>)}</select></Field></div>
  <p className="text-xs leading-6 text-muted-foreground">Aceptamos coma o punto decimal, sin separadores de miles. Los balances finales siempre quedan en UYU.</p>
  <fieldset className="space-y-3"><legend className="mb-3 text-sm font-medium">Quiénes participan del gasto</legend><p className="text-xs leading-6 text-muted-foreground">Marcá solo a quienes comparten este gasto. Quien pagó puede quedar fuera.</p><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={()=>{setSelected(available.filter(p=>p.status==="active").map(p=>p.id));setReviewed(false);}}>Seleccionar participantes activos</Button><Button type="button" variant="ghost" size="sm" disabled={!selected.length} onClick={()=>{setSelected([]);setReviewed(false);}}>Quitar selección</Button></div>{available.map(p=><div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg border px-3"><label className="flex min-h-11 flex-1 items-center gap-3 py-2 text-sm"><input type="checkbox" checked={selected.includes(p.id)} onChange={e=>{setSelected(old=>e.target.checked?[...old,p.id]:old.filter(x=>x!==p.id));setReviewed(false);}}/>{p.name}{p.status==="retired"?" (histórico)":""}</label>{method!=="equal"&&selected.includes(p.id)&&<input aria-label={`${method==="percent"?"Porcentaje":method==="custom"?"Importe UYU":"Cantidad"} de ${p.name}`} className={`${inputClass} my-2 max-w-36`} inputMode="decimal" value={inputs[p.id]??"1"} onChange={e=>{setInputs(old=>({...old,[p.id]:e.target.value}));setReviewed(false);}}/>}</div>)}</fieldset>
  <Field label="Reparto"><select className={inputClass} name="method" value={method} onChange={e=>{setMethod(e.target.value as SplitMethod);setReviewed(false);}}><option value="equal">Partes iguales</option><option value="percent">Porcentajes (100% exacto)</option><option value="custom">Importes personalizados en UYU</option><option value="units">Cantidades proporcionales</option></select></Field>
  {method!=="equal"&&<p className="text-xs text-muted-foreground">Los importes personalizados son en UYU. Porcentajes y cantidades admiten hasta 4 decimales.</p>}
  <section aria-label="Vista previa del reparto" aria-live="polite" className="space-y-3 rounded-xl border bg-primary/5 p-4"><h3 className="text-sm font-semibold">Total: {total===undefined?"—":formatUyu(total)}</h3>{error?<p id={errorId} className="text-xs leading-6 text-muted-foreground">{!amount?"Ingresá el importe y seleccioná las personas para ver cuánto paga cada una.":error}</p>:preview.map(s=><p key={s.personId} className="flex justify-between gap-3 text-sm"><span>{available.find(p=>p.id===s.personId)?.name}</span><strong>{formatUyu(s.amount)}</strong></p>)}{!error&&<p id={errorId} className="text-xs leading-6 text-muted-foreground">{preview.length} {preview.length===1?"persona seleccionada":"personas seleccionadas"}. El total se reparte en centésimos exactos.</p>}<label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6"><input type="checkbox" name="reviewedParticipants" value="yes" required checked={reviewed} onChange={e=>setReviewed(e.target.checked)} className="mt-1"/>Revisé quiénes participan y cuánto paga cada persona.</label></section>
  <details className="rounded-xl border p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Más opciones: fecha y comprobante</summary><div className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Fecha"><input className={inputClass} type="date" name="date" required value={date} onChange={e=>setDate(e.target.value)}/></Field><Field label="Categoría"><select className={inputClass} name="category" value={category} onChange={e=>setCategory(e.target.value)}><option value="food">Comida</option><option value="travel">Viajes</option><option value="home">Hogar</option><option value="sports">Deportes</option><option value="other">Otros</option></select></Field></div>{currency!=="UYU"?<p className="text-xs leading-6 text-muted-foreground">Moneda histórica: {currency}. Cotización conservada: {rate.replace(".",",")} UYU. La moneda y la tasa no se modifican durante la beta.</p>:<p className="text-xs text-muted-foreground">Moneda: UYU. Las operaciones nuevas de la beta son en pesos uruguayos, sin conversión.</p>}<Field label="Notas (opcional)"><textarea className={`${inputClass} min-h-24 py-2`} name="notes" maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></Field><Field label="Comprobante privado (PNG, JPEG o PDF; hasta 512 KiB)"><input type="file" name="receipt" accept="image/png,image/jpeg,application/pdf" className={inputClass}/></Field>{initial?.receipt&&<label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" name="removeReceipt" value="yes"/>Quitar el comprobante de la nueva versión (el histórico se conserva)</label>}</div></details>
 </ActionForm>;
}
