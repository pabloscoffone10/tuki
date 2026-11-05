"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/features/groups/components/fields";
import { feedbackCategories } from "./schema";
import { submitFeedback } from "./actions";
export function FeedbackForm() {
  const [state, action, pending] = useActionState(submitFeedback, { ok: false, message: "" });
  if (state.ok) return <p role="status" className="rounded-xl border bg-card p-6 leading-7">{state.message}</p>;
  return <form action={action} className="space-y-5 rounded-xl border bg-card p-5 sm:p-7"><Field label="Categoría"><select name="category" className={inputClass}>{Object.entries(feedbackCategories).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field><Field label="Descripción (obligatoria)"><textarea name="description" required maxLength={4000} rows={7} className={`${inputClass} h-auto py-3`} aria-describedby="feedback-description"/></Field><p id="feedback-description" className="text-xs text-muted-foreground">Hasta 4000 caracteres. No incluyas contraseñas ni datos bancarios sensibles.</p><Field label="Correo (opcional)"><input name="email" type="email" maxLength={254} autoComplete="email" className={inputClass}/></Field><div hidden aria-hidden="true"><label>Sitio web<input name="website" defaultValue="" tabIndex={-1} autoComplete="off"/></label></div>{state.message && <p role="alert" className="text-sm text-destructive">{state.message}</p>}<Button disabled={pending} type="submit">{pending ? "Enviando…" : "Enviar reporte"}</Button></form>;
}
