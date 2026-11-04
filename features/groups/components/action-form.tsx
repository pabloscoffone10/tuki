"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GroupState } from "../types";
import { isOnline,useConnectivity } from "@/components/pwa/connectivity";
import { unstable_rethrow } from "next/navigation";

export function ActionForm({ action, children, label, variant = "default" }: {
  action: (state: GroupState, form: FormData) => Promise<GroupState>;
  children: ReactNode; label: string; variant?: "default" | "outline";
}) {
  const preserveDraft=useRef(false);
  const [state, submit, pending] = useActionState(async(previous:GroupState,form:FormData)=>{
    try{const result=await action(previous,form);preserveDraft.current=!!result.error;return result;}
    catch(error){unstable_rethrow(error);preserveDraft.current=true;return {error:"No recibimos una confirmación del servidor. El formulario se conserva en esta ventana. Revisá el estado antes de volver a enviar."};}
  }, {});
  const online=useConnectivity();
  const errorRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(state.error)errorRef.current?.focus();},[state.error]);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  return <form action={submit} onReset={event=>{if(preserveDraft.current)event.preventDefault();}} onSubmitCapture={event=>{if(!isOnline())event.preventDefault();}} className="space-y-4">
    <fieldset disabled={pending} className="space-y-4 disabled:opacity-50">{children}</fieldset>
    <div aria-live="polite" className="space-y-2">
      {state.error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{state.error}</p>}
      {state.fields && Object.entries(state.fields).map(([key, errors]) => errors?.length ? <p key={key} className="text-xs text-destructive">{errors[0]}</p> : null)}
      {state.success && <p role="status" className="rounded-lg border border-success/20 bg-success/5 p-3 text-sm leading-6 text-success">{state.success}</p>}
    </div>
    {state.invitationUrl && <div className="space-y-2 rounded-lg border bg-background p-3">
      <label className="block text-xs font-medium" htmlFor="generated-invitation">Enlace privado de un solo uso</label>
      <input id="generated-invitation" readOnly value={state.invitationUrl} onFocus={(event) => event.currentTarget.select()} className="h-10 w-full rounded-md border bg-card px-2 text-xs" />
      <Button type="button" variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(state.invitationUrl!); setCopied(true); setCopyError(false); } catch { setCopyError(true); } }}>{copied ? <Check /> : <Copy />}{copied ? "Copiado" : "Copiar enlace"}</Button>
      {copyError && <p role="status" className="text-xs text-muted-foreground">Seleccioná el enlace y copialo manualmente.</p>}
    </div>}
    {!online&&<p role="status" className="text-xs text-muted-foreground">Necesitás conexión para enviar. Podés seguir revisando el formulario en esta ventana.</p>}
    <Button type="submit" variant={variant} disabled={pending||!online}>{pending && <LoaderCircle className="animate-spin" aria-hidden="true" />}{pending ? "Guardando…" : label}</Button>
  </form>;
}
