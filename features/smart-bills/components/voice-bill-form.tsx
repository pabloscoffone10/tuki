"use client";
import { useEffect,useRef,useState } from "react";
import { Mic,Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field,inputClass } from "@/features/groups/components/fields";
import type { FinancePerson } from "@/features/finance/types";
import { formatUyu } from "@/features/finance/domain";
import { normalizeDecimalInput } from "@/lib/decimal-input";
import { analyzeVoice,saveVoiceExpense,type VoiceState } from "../voice-actions";
import { resolveVoice,voiceSummary,type VoiceItem } from "../voice-domain";

type Recognition={lang:string;continuous:boolean;interimResults:boolean;onresult:((e:{results:ArrayLike<{isFinal:boolean;0:{transcript:string}}>})=>void)|null;onerror:((e:{error:string})=>void)|null;onend:(()=>void)|null;start:()=>void;stop:()=>void;abort:()=>void};
type SpeechWindow=Window&{SpeechRecognition?:new()=>Recognition;webkitSpeechRecognition?:new()=>Recognition};
export function VoiceBillForm({id,groupId,people,currentPersonId,visible=true}:{id:string;groupId:string;people:FinancePerson[];currentPersonId?:string;visible?:boolean}){
 const active=people.filter(p=>p.status==="active"&&!p.replaced);
 const [text,setText]=useState(""),[listening,setListening]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[consent,setConsent]=useState(false),[state,setState]=useState<VoiceState>({});
 const [items,setItems]=useState<VoiceItem[]>([]),[total,setTotal]=useState(""),[currency,setCurrency]=useState(false),[reviewed,setReviewed]=useState(false),[draft,setDraft]=useState(false),[date,setDate]=useState(()=>new Date().toLocaleDateString("en-CA",{timeZone:"America/Montevideo"}));
 const speech=useRef<Recognition|null>(null),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),lock=useRef(false),textarea=useRef<HTMLTextAreaElement>(null);
 const keepListening=useRef(false),restartTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
 useEffect(()=>()=>{keepListening.current=false;clearTimeout(timer.current);clearTimeout(restartTimer.current);if(speech.current){speech.current.onresult=null;speech.current.onend=null;speech.current.onerror=null;speech.current.abort();}},[]);
 useEffect(()=>{if(!visible){keepListening.current=false;clearTimeout(timer.current);clearTimeout(restartTimer.current);speech.current?.abort();}},[visible]);
 function stop(){keepListening.current=false;clearTimeout(restartTimer.current);speech.current?.stop();clearTimeout(timer.current);setListening(false);}
 function start(){
  if(keepListening.current)return;
  if(!window.isSecureContext){setError("Para usar el micrófono, abrí Tuki con HTTPS o en localhost. Podés escribir el texto mientras tanto.");return;}
  const browser=window as SpeechWindow,Engine=browser.SpeechRecognition??browser.webkitSpeechRecognition;
  if(!Engine){setError("Este navegador no admite reconocimiento de voz. Escribí el texto para continuar.");textarea.current?.focus();return;}
  setError("");const recognition=new Engine();speech.current=recognition;let prefix=text.trim(),sessionText="",emptyEnds=0;
  keepListening.current=true;
  recognition.lang="es-UY";recognition.continuous=true;recognition.interimResults=true;
  recognition.onresult=e=>{if(speech.current!==recognition)return;sessionText=Array.from(e.results).map(r=>r[0].transcript).join(" ").trim();setText((prefix+" "+sessionText).trim().slice(0,12000));setReviewed(false);};
  let fallback=false;
  recognition.onend=()=>{
   if(speech.current!==recognition)return;
   if(keepListening.current){
    if(fallback){fallback=false;recognition.lang="es-ES";emptyEnds=0;}else emptyEnds=sessionText?0:emptyEnds+1;
    prefix=(prefix+" "+sessionText).trim().slice(0,12000);sessionText="";
    if(emptyEnds<3){restartTimer.current=setTimeout(()=>{
     if(!keepListening.current||speech.current!==recognition)return;
     try{recognition.start();}catch{keepListening.current=false;clearTimeout(timer.current);setListening(false);setError("El navegador interrumpió la escucha. Reintentá o escribí el texto; lo transcripto se conserva.");}
    },250);return;}
    keepListening.current=false;setError("El navegador cerró la escucha varias veces sin reconocer voz. Revisá el micrófono y reintentá; el texto se conserva.");
   }
   clearTimeout(timer.current);setListening(false);
  };
  recognition.onerror=e=>{
   if(speech.current!==recognition||!keepListening.current)return;
   if(e.error==="no-speech")return;
   if(e.error==="language-not-supported"&&recognition.lang==="es-UY"){
    fallback=true;return;
   }
   keepListening.current=false;clearTimeout(restartTimer.current);clearTimeout(timer.current);setListening(false);setError(e.error==="not-allowed"?"El navegador bloqueó el micrófono. En el icono de permisos junto a la dirección, permití el micrófono para Tuki y recargá la página. También podés escribir el texto.":e.error==="service-not-allowed"?"El navegador o su política bloqueó el servicio de reconocimiento de voz. Probá abrir Tuki directamente en una pestaña de Chrome o Edge, o escribí el texto.":e.error==="audio-capture"?"No se encontró un micrófono disponible. Revisá el dispositivo y sus permisos en el sistema, o escribí el texto.":"No pudimos transcribir. Reintentá o escribí el texto.");
  };
  try{recognition.start();setListening(true);timer.current=setTimeout(stop,60000);}catch{keepListening.current=false;setError("No se pudo iniciar el micrófono. Escribí el texto.");}
 }
 function change(id:string,patch:Partial<VoiceItem>){setItems(old=>old.map(i=>i.id===id?{...i,...patch}:i));setReviewed(false);}
 function add(){setItems(old=>[...old,{id:crypto.randomUUID(),name:"",amount:"",payerId:"",consumers:[]}]);setDraft(true);setReviewed(false);}
 async function analyze(retry=false){
  if(lock.current)return;lock.current=true;setBusy(true);setError("");
  try{
   const f=new FormData();f.set("groupId",groupId);f.set("text",text);f.set("consent",consent?"yes":"no");if(retry)f.set("retry","yes");
   const result=await analyzeVoice(f);setState(result);
   if(result.data){setItems(resolveVoice(result.data,active,result.self??currentPersonId));setTotal(result.data.total??"");setCurrency(result.data.currency==="UYU");setDraft(true);setReviewed(false);}
   if(result.error)setError(result.error);
  }catch{setError("No pudimos confirmar el análisis. Consultá de nuevo con el mismo texto o continuá manualmente.");}
  finally{lock.current=false;setBusy(false);}
 }
 let summary:ReturnType<typeof voiceSummary>|undefined,issue="";
 try{summary=voiceSummary(items,active,total);}catch(e){issue=e instanceof Error?e.message:"Revisá los gastos.";}
 const missing=items.map(item=>({item,field:!item.name.trim()?"name":!validAmount(item.amount)?"amount":!active.some(p=>p.id===item.payerId)?"payerId":!item.consumers.length?"consumers":""})).find(row=>row.field);
 function chips(item:VoiceItem){return <div className="flex flex-wrap gap-2">{active.map(p=><button key={p.id} type="button" aria-pressed={item.consumers.includes(p.id)} className={`min-h-11 rounded-full border px-4 text-sm ${item.consumers.includes(p.id)?"border-primary bg-primary/10 text-primary":"hover:bg-muted"}`} onClick={()=>change(item.id,{consumers:item.consumers.includes(p.id)?item.consumers.filter(id=>id!==p.id):[...item.consumers,p.id]})}>{p.name}</button>)}</div>;}
 async function save(){
  if(lock.current||!reviewed||!currency||!summary||summary.difference||items.length!==1)return;
  lock.current=true;setBusy(true);setError("");
  try{
   const f=new FormData();f.set("id",id);f.set("groupId",groupId);f.set("date",date);f.set("confirmed","yes");f.set("currency","UYU");f.set("total",total?normalizeDecimalInput(total,2):"");f.set("items",JSON.stringify(items.map(i=>({...i,amount:normalizeDecimalInput(i.amount,2)}))));
   const result=await saveVoiceExpense(f);if(result?.error)setError(result.error);
  }catch{setError("No pudimos confirmar el guardado. Consultá Gastos antes de reintentar; el mismo borrador conserva su identificador.");}
  finally{lock.current=false;setBusy(false);}
 }
 return <section aria-label="Gastos por voz" className="space-y-5">
  <h2 className="text-xl font-semibold">Contá los gastos</h2>
  <p className="text-sm text-muted-foreground">El reconocimiento puede usar servicios del navegador. Tuki no almacena audio y envía únicamente el texto confirmado a Gemini. Máximo un minuto por intento.</p>
  <div className="flex flex-wrap gap-3"><Button type="button" disabled={busy} onClick={listening?stop:start}>{listening?<Square aria-hidden="true"/>:<Mic aria-hidden="true"/>}{listening?"Detener":"Iniciar micrófono"}</Button><Button type="button" variant="ghost" onClick={()=>textarea.current?.focus()}>Escribir en lugar de hablar</Button></div>
  <p role="status" aria-live="polite">{listening?"Escuchando…":""}</p>
  <Field label="Transcripción editable"><textarea ref={textarea} className={`${inputClass} min-h-32 py-3`} maxLength={12000} disabled={busy||listening} value={text} onChange={e=>setText(e.target.value)} placeholder="Contá qué se pagó, cuánto costó, quién pagó y quiénes participaron."/></Field>
  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Confirmo este texto y acepto enviarlo a Gemini para interpretarlo y recuperar el análisis durante un día. La carga manual sigue disponible.</label>
  <div className="flex flex-wrap gap-3"><Button disabled={!consent||!text.trim()||busy||listening} onClick={()=>analyze()}>Confirmar texto y analizar</Button><Button variant="outline" disabled={busy||listening} onClick={add}>Agregar gasto manual</Button></div>
  {state.retryRequired&&<Button variant="outline" disabled={busy||!consent} onClick={()=>analyze(true)}>Acepto un nuevo intento que podría generar otro costo</Button>}
  {error&&<p role="alert" className="text-sm text-destructive">{error}</p>}
  {draft&&<div className="space-y-5" aria-busy={busy}>
   {state.data?.warnings.map((w,i)=><p key={i} className="text-sm text-amber-700 dark:text-amber-300">{w}</p>)}
   {state.data&&!state.data.complete&&<p className="text-sm">La interpretación está incompleta: compará todos los gastos con el texto y agregá los que falten.</p>}
   {!currency&&<label className="flex gap-3 text-sm"><input type="checkbox" checked={currency} onChange={e=>{setCurrency(e.target.checked);setReviewed(false);}}/>Confirmo que todos los importes están expresados en pesos uruguayos (UYU). Si hay otra moneda, corregí el texto; no se convierte.</label>}
   {missing?<section className="space-y-4 rounded-xl border bg-card p-5" aria-label="Dato pendiente">
    <h3 className="font-medium">{missing.field==="name"?"¿Cuál es el concepto del gasto?":missing.field==="amount"?`¿Cuánto costó ${missing.item.name}?`:missing.field==="payerId"?`¿Quién pagó ${missing.item.name}?`:`¿Quiénes consumieron ${missing.item.name}?`}</h3>
    <VoiceQuestion key={missing.item.id+missing.field} item={missing.item} field={missing.field} people={active} onContinue={patch=>change(missing.item.id,patch)}/>
    <Button variant="ghost" onClick={()=>{setItems(old=>old.filter(i=>i.id!==missing.item.id));setReviewed(false);}}>Eliminar este gasto</Button>
   </section>:items.map((item,index)=><section key={item.id} aria-label={`Gasto ${index+1}`} className="space-y-4 rounded-xl border bg-card p-5">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Concepto"><input className={inputClass} maxLength={120} value={item.name} onChange={e=>change(item.id,{name:e.target.value})}/></Field><Field label="Importe UYU"><input className={inputClass} inputMode="decimal" value={item.amount} onChange={e=>change(item.id,{amount:e.target.value})}/></Field></div>
    <Field label="Pagó"><select className={inputClass} value={item.payerId} onChange={e=>change(item.id,{payerId:e.target.value})}>{active.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
    <p className="text-sm font-medium">Consumieron</p>{chips(item)}<Button variant="ghost" onClick={()=>{setItems(old=>old.filter(i=>i.id!==item.id));setReviewed(false);}}>Eliminar gasto</Button>
   </section>)}
   <Field label="Total narrado UYU (si se mencionó)"><input className={inputClass} inputMode="decimal" value={total} onChange={e=>{setTotal(e.target.value);setReviewed(false);}}/></Field>
   {summary?<section className="space-y-3 rounded-xl border p-5"><p className="font-semibold">Total de gastos: {formatUyu(summary.total)}</p>{summary.difference!==null&&summary.difference!==0n&&<p role="alert">El total narrado no coincide. Diferencia: {formatUyu(summary.difference)}. Corregí los importes o el total.</p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Persona","Pagó","Le corresponde","Saldo"].map(s=><th key={s} className="p-2">{s}</th>)}</tr></thead><tbody>{summary.ledger.map(p=><tr key={p.id}><td className="p-2">{p.name}</td><td className="p-2">{formatUyu(p.paid)}</td><td className="p-2">{formatUyu(p.consumed)}</td><td className="p-2">{formatUyu(p.paid-p.consumed)}</td></tr>)}</tbody></table></div></section>:issue&&<p className="text-sm">{issue}</p>}
   {items.length>1&&<p role="alert" className="rounded-xl border p-4 text-sm">El borrador conserva cada gasto y su pagador. Guardar varios gastos juntos requiere una operación atómica aún no disponible. Este borrador no se guardó; el guardado múltiple está bloqueado para evitar resultados parciales.</p>}
   <Field label="Fecha del gasto"><input type="date" className={inputClass} value={date} onChange={e=>{setDate(e.target.value);setReviewed(false);}}/></Field>
   <label className="flex gap-3 text-sm"><input type="checkbox" disabled={busy} checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>Revisé el texto, los gastos, los pagadores y el reparto.</label>
   <Button disabled={busy||listening||!reviewed||!currency||!summary||!!summary.difference||items.length!==1} onClick={save}>{busy?"Procesando…":"Confirmar y guardar gasto"}</Button>
  </div>}
 </section>;
}
function validAmount(value:string){try{return BigInt(normalizeDecimalInput(value,2).replace(".",""))>0n;}catch{return false;}}
function VoiceQuestion({item,field,people,onContinue}:{item:VoiceItem;field:string;people:FinancePerson[];onContinue:(patch:Partial<VoiceItem>)=>void}){
 const [value,setValue]=useState(field==="consumers"?"":String(item[field as "name"|"amount"|"payerId"]));
 const [selected,setSelected]=useState(item.consumers);
 return <div className="space-y-4">{field==="consumers"?<div className="flex flex-wrap gap-2">{people.map(p=><Button key={p.id} variant={selected.includes(p.id)?"default":"outline"} aria-pressed={selected.includes(p.id)} onClick={()=>setSelected(old=>old.includes(p.id)?old.filter(id=>id!==p.id):[...old,p.id])}>{p.name}</Button>)}</div>:field==="payerId"?<select aria-label="Pagador pendiente" className={inputClass} value={value} onChange={e=>setValue(e.target.value)}><option value="">Elegí una persona</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select>:<input aria-label="Dato pendiente" className={inputClass} inputMode={field==="amount"?"decimal":"text"} value={value} onChange={e=>setValue(e.target.value)}/>}<Button disabled={field==="consumers"?!selected.length:field==="amount"?!validAmount(value):!value.trim()} onClick={()=>onContinue(field==="consumers"?{consumers:selected}:{[field]:value})}>Continuar</Button></div>;
}
