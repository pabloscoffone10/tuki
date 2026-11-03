"use client";
import { useActionState,useEffect,useRef,useState,type ReactNode } from "react";
import { useRouter,unstable_rethrow } from "next/navigation";
import { Button } from "@/components/ui/button";
import { recoverPaymentOperation,resumePaymentOperation,resolvePaymentOperation } from "../operation-actions";
import { operationMessage,type OperationReply } from "../operation-types";
import { createPayment } from "../actions";
import { paymentError } from "../errors";
import { isOnline,useConnectivity } from "@/components/pwa/connectivity";
const methodNames:Record<string,string>={cash:"Efectivo",bank:"Transferencia externa",other:"Otro"};

export function PaymentOperationPanel({initial,onClear}:{initial:OperationReply;onClear:()=>void}){
 const online=useConnectivity();
 const router=useRouter(),lock=useRef(false);const [reply,setReply]=useState(initial),[busy,setBusy]=useState(false),[consent,setConsent]=useState(false);
 async function run(action:()=>Promise<OperationReply>){if(lock.current||!isOnline())return;lock.current=true;setBusy(true);try{const result=await action();setReply(result.operation===undefined&&result.error?{...result,operation:reply.operation}:result);setConsent(false);if(result.operation===null&&!result.error&&!result.unknown){onClear();router.refresh();}}catch{setReply({unknown:true,error:"No se recibió una respuesta verificable. Consultá el estado antes de continuar."});}finally{lock.current=false;setBusy(false);}}
 const op=reply.operation;
 return <section aria-label="Recuperación de pago" className="space-y-4 rounded-xl border border-primary/30 bg-primary/5 p-4"><h3 className="font-semibold">{busy?"Procesando la misma operación…":reply.unknown?"Resultado desconocido: requiere conciliación":op?.state==="processed"?"Operación procesada":op?.state==="rejected"?"Intento rechazado sin registrar pago":"Operación no enviada"}</h3>{op&&<><p className="break-all text-xs">Referencia: {op.id}</p><p className="text-sm">{operationMessage(op)}</p>{op.summary&&<p className="text-sm">{op.summary.payer_name} → {op.summary.receiver_name} · {op.summary.amount} UYU · {op.summary.date} · {methodNames[op.summary.method]??op.summary.method}{op.summary.group_name?` · ${op.summary.group_name}`:""}{op.summary.administrative?" · Declaración administrativa, no prueba bancaria":op.summary.received?" · Recepción personal declarada":""}</p>}{op.summary?.administrative&&op.summary.reason&&<p className="text-sm">Motivo administrativo: {op.summary.reason}</p>}{op.state==="rejected"&&op.error_code&&!reply.error&&<p role="alert" className="text-sm">{paymentError({message:op.error_code})}</p>}</>}{reply.error&&<p role="alert" className="text-sm">{reply.error}</p>}{reply.success&&<p role="status" className="text-sm">{reply.success}</p>}<p className="text-xs text-muted-foreground">No se inició otro pago. Cerrar esta pantalla o recargar conserva el intento en tu cuenta, sin datos financieros en el almacenamiento del navegador.</p><div className="flex flex-wrap gap-3"><Button type="button" size="sm" variant="outline" disabled={busy||!online} onClick={()=>void run(()=>recoverPaymentOperation())}>Consultar resultado original</Button>{op&&!reply.unknown&&(op.state==="processed"||op.state==="rejected")&&<Button type="button" size="sm" disabled={busy||!online} onClick={()=>void run(()=>resolvePaymentOperation(op.id,"ack"))}>Reconocer resultado e iniciar otro pago</Button>}</div>{op&&!reply.unknown&&op.state==="prepared"&&<><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>Confirmo enviar el intento original mostrado, sin crear un pago adicional.</label><div className="flex flex-wrap gap-3"><Button type="button" disabled={busy||!online||!consent} onClick={()=>void run(()=>resumePaymentOperation(op.id,true))}>Enviar el mismo intento</Button><Button type="button" variant="outline" disabled={busy||!online} onClick={()=>void run(()=>resolvePaymentOperation(op.id,"cancel"))}>Cancelar intento no enviado</Button></div></>}</section>;
}

export function PaymentRecoveryBoundary({children}:{children:ReactNode}){
 const online=useConnectivity();
 const [reply,setReply]=useState<OperationReply>(),[generation,setGeneration]=useState(0);
 useEffect(()=>{let active=true;queueMicrotask(async()=>{if(!isOnline()){if(active)setReply({unknown:true,error:"Sin conexión. Consultá el intento original cuando vuelva Internet."});return;}try{const result=await recoverPaymentOperation();if(active)setReply(result);}catch{if(active)setReply({unknown:true,error:"No pudimos comprobar si existe un pago anterior. Revisá la conexión antes de continuar."});}});return()=>{active=false;};},[generation]);
 if(!reply)return <p role="status" className="text-sm">{online?"Comprobando operaciones pendientes…":"Sin conexión. Consultá las operaciones pendientes al volver a conectarte."}</p>;
 if(reply.operation||reply.unknown||reply.error)return <PaymentOperationPanel initial={reply} onClear={()=>{setReply(undefined);setGeneration(n=>n+1);}}/>;
 return <div key={generation}>{children}</div>;
}

export function PaymentOperationForm({children,label}:{children:ReactNode;label:string}){
 const online=useConnectivity();
 const [state,submit,pending]=useActionState(async(previous:OperationReply,form:FormData):Promise<OperationReply>=>{
  try{return await createPayment(previous,form);}catch(error){unstable_rethrow(error);return {unknown:true,error:"Se perdió la respuesta. Consultá el intento original antes de registrar otro pago."};}
 },{});const [generation,setGeneration]=useState(0);
 if(state.operation||state.unknown)return <PaymentOperationPanel key={generation} initial={state} onClear={()=>{setGeneration(n=>n+1);window.location.reload();}}/>;
 return <form action={submit} onSubmitCapture={event=>{if(!isOnline())event.preventDefault();}} className="space-y-4"><fieldset disabled={pending} className="space-y-4 disabled:opacity-50">{children}</fieldset><div aria-live="polite">{state.error&&<p role="alert" className="text-sm text-destructive">{state.error}</p>}</div>{!online&&<p role="status" className="text-xs">Necesitás conexión para enviar este pago. El formulario permanece en esta ventana.</p>}<Button disabled={pending||!online}>{pending?"Procesando operación…":label}</Button></form>;
}
