"use client";
import { useEffect,useState } from "react";
import { Button } from "@/components/ui/button";
import { Field,inputClass } from "@/features/groups/components/fields";
import { loadBankAccounts } from "./actions";
import { compatibleAccounts,type BankAccount } from "./schema";
export function RecipientAccounts({receiver,amount,onSelect}:{receiver:string;amount:string;onSelect:(id:string)=>void}){
 const [accounts,setAccounts]=useState<BankAccount[]>([]),[selected,setSelected]=useState(""),[message,setMessage]=useState("Consultando cuentas…");
 useEffect(()=>{let active=true;void loadBankAccounts(receiver).then(r=>{if(!active)return;const list=compatibleAccounts(r.accounts??[],"UYU");setAccounts(list);setSelected(list[0]?.id??"");onSelect(list[0]?.id??"");setMessage(r.error??(list.length?"":"El destinatario no tiene cuentas en UYU. Pedile sus datos; si transferiste por fuera de Tuki, usá Registrar pago pendiente."));});return()=>{active=false;};},[receiver,onSelect]);
 const account=accounts.find(a=>a.id===selected);
 async function copy(value:string){try{await navigator.clipboard.writeText(value);setMessage("Datos copiados.");}catch{setMessage("No pudimos copiar. Seleccioná los datos y copialos manualmente.");}}
 return <div className="space-y-3 rounded-lg border p-3">{!!accounts.length&&<Field label="Cuenta del destinatario · UYU"><select className={inputClass} value={selected} onChange={e=>{setSelected(e.target.value);onSelect(e.target.value);}}>{accounts.map(a=><option key={a.id} value={a.id}>{a.bank} · {a.alias||a.holder}{a.is_default?" · Predeterminada":""}</option>)}</select></Field>}{account&&<><p className="break-all text-sm">{account.bank} · {account.holder}<br/>{account.identifier}<br/>Importe: {amount} UYU</p><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={()=>void copy(account.identifier)}>Copiar número de cuenta</Button><Button size="sm" variant="outline" onClick={()=>void copy(amount)}>Copiar importe</Button><Button size="sm" variant="outline" onClick={()=>void copy(`${account.bank}\n${account.holder}\n${account.identifier}\n${amount} UYU`)}>Copiar datos para transferir</Button></div></>}<p className="text-xs text-muted-foreground">Abrí tu aplicación bancaria manualmente. Tuki no inicia transferencias ni maneja dinero. Tu declaración requiere confirmación del receptor.</p>{message&&<p role="status" className="text-sm">{message}</p>}</div>;
}
