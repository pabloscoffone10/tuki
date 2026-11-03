"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { transitionPayment } from "@/features/payments/actions";
import type { Notice } from "./types";
import { isOnline,useConnectivity } from "@/components/pwa/connectivity";

export function NotificationPaymentActions({notice,onSuccess}:{notice:Notice;onSuccess:()=>Promise<void>}){
 const online=useConnectivity();
 const router=useRouter();const [action,setAction]=useState<"confirm"|"reject">(),[requestId,setRequestId]=useState(""),[reason,setReason]=useState(""),[confirmed,setConfirmed]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 if(!notice.can_confirm||!notice.payment_id||!notice.payment_version)return null;
 const needsReason=action==="reject"||notice.confirm_as_admin;const requiredReason=action==="reject"||(notice.confirm_as_admin&&!notice.optional_admin_reason);
 return <div className="space-y-3 rounded-lg border p-3"><div className="flex flex-wrap gap-2">{(["confirm","reject"] as const).map(a=><Button key={a} size="sm" variant="outline" disabled={busy||!online} onClick={()=>{setAction(a);setRequestId(crypto.randomUUID());setConfirmed(false);setReason("");setMessage("");}}>{a==="confirm"?(notice.confirm_as_admin?"Confirmar como administrador":"Recibí el pago"):(notice.confirm_as_admin?"Rechazar pago":"No recibí el pago")}</Button>)}</div>{action&&<><p className="text-xs">{notice.confirm_as_admin?"Declaración administrativa para un pago con invitados, no prueba bancaria.":action==="confirm"?"Confirmá que recibiste el dinero fuera de Tuki.":"El rechazo conserva la deuda pendiente."}</p>{needsReason&&<label className="block text-xs">{requiredReason?"Motivo (mínimo 8 caracteres)":"Motivo adicional (opcional)"}<textarea className="mt-2 w-full rounded-lg border bg-background p-2" required={!!requiredReason} minLength={requiredReason?8:undefined} maxLength={500} value={reason} onChange={e=>{setReason(e.target.value);setConfirmed(false);}}/></label>}<label className="flex gap-2 text-xs"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>Confirmo esta operación.</label><Button size="sm" disabled={busy||!online||!confirmed||(requiredReason&&reason.trim().length<8)} onClick={async()=>{if(!isOnline())return;setBusy(true);const form=new FormData();for(const [k,v] of Object.entries({id:notice.payment_id!,version:String(notice.payment_version),action,requestId,reason,confirm:"yes"}))form.set(k,v);try{const result=await transitionPayment({},form);setMessage(result.error??result.success??"");if(result.success){setAction(undefined);await onSuccess();router.refresh();}}catch{setMessage("No pudimos procesarlo. Reintentá con esta misma operación.");}finally{setBusy(false);}}}>{busy?"Guardando…":"Confirmar operación"}</Button></>}{message&&<p role="status" className="text-xs">{message}</p>}</div>;
}
