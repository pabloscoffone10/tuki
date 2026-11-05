"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ExpenseForm } from "@/features/finance/components/expense-form";
import type { FinancePerson } from "@/features/finance/types";
import { SmartBillForm } from "./smart-bill-form";
import { VoiceBillForm } from "./voice-bill-form";
import { Mic,ScanLine } from "lucide-react";
export function ExpenseComposer(props:{id:string;groupId:string;people:FinancePerson[];aiAvailable:boolean;currentPersonId?:string;prefill?:{title:string;amount:string}}){
 const [mode,setMode]=useState("normal"),[smartMode,setSmartMode]=useState<"scan"|"voice"|null>(null);
 return <div className="space-y-6"><div className="flex flex-wrap gap-3" aria-label="Tipo de gasto"><Button type="button" variant={mode==="normal"?"default":"outline"} onClick={()=>setMode("normal")}>Gasto normal</Button><Button type="button" variant={mode==="smart"?"default":"outline"} onClick={()=>setMode("smart")}>Cuenta Inteligente <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">BETA</span></Button></div><div hidden={mode!=="normal"}><ExpenseForm {...props}/></div><div hidden={mode!=="smart"} className="space-y-5">
 {!smartMode&&<section className="space-y-5"><h2 className="text-xl font-semibold">Cuenta Inteligente · <span className="text-sm text-primary">BETA</span></h2><p className="text-sm text-muted-foreground">Elegí cómo querés agregar los gastos de tu grupo.</p><div className="grid gap-4 sm:grid-cols-2">{([{key:"scan",title:"Escanear ticket",description:"Sacá una foto y asigná los consumos.",Icon:ScanLine},{key:"voice",title:"Usar voz",description:"Contá los gastos y dejá que Tuki los organice.",Icon:Mic}] as const).map(({key,title,description,Icon})=><button key={key} type="button" className="space-y-3 rounded-2xl border bg-card p-6 text-left transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary" onClick={()=>setSmartMode(key)}><Icon aria-hidden="true" className="size-7 text-violet-500"/><span className="block font-semibold">{title}</span><span className="block text-sm text-muted-foreground">{description}</span></button>)}</div></section>}
 {smartMode&&<Button type="button" variant="ghost" onClick={()=>setSmartMode(null)}>← Elegir modalidad</Button>}
 <div hidden={smartMode!=="scan"}><SmartBillForm {...props}/></div>
 <div hidden={smartMode!=="voice"||mode!=="smart"}><VoiceBillForm {...props} visible={smartMode==="voice"&&mode==="smart"}/></div>
 </div></div>;
}
