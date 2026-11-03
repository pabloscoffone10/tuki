"use client";
import { useState } from "react";
import { replaceGuest } from "../actions";
import type { ReusableGuest } from "../types";
import { ActionForm } from "./action-form";
import { Confirmation, Field, inputClass } from "./fields";

export function ReplaceGuestForm({ groupId, sourceId, sourceName, candidates }: { groupId: string; sourceId: string; sourceName: string; candidates: ReusableGuest[] }) {
  const [selected, setSelected] = useState("");
  const target = candidates.find((person) => person.id === selected);
  return <ActionForm action={replaceGuest} label="Confirmar reemplazo en este grupo" variant="outline">
    <input type="hidden" name="groupId" value={groupId} /><input type="hidden" name="sourcePersonId" value={sourceId} />
    <p className="text-xs leading-6 text-muted-foreground">Solo para corregir duplicados antes de cargar gastos. Se retirará «{sourceName}» ({sourceId.slice(0, 8)}) en este grupo y se usará la identidad que elijas. No se fusionan personas ni se cambian otros grupos.</p>
    <Field label="Identidad invitada correcta"><select name="targetPersonId" required value={selected} onChange={(event) => setSelected(event.target.value)} className={inputClass}><option value="">Elegí por identidad y grupo de referencia</option>{candidates.map((person) => <option key={person.id} value={person.id}>{person.display_name} · {person.memberships.map((membership) => membership.group?.name).filter(Boolean).join(", ") || "Invitado que creaste"} · {person.id.slice(0, 8)}</option>)}</select></Field>
    {target && <p role="status" className="rounded-lg border p-3 text-xs leading-6">Identidad que se conservará: <strong>{target.display_name}</strong><br /><span className="break-all">ID global: {target.id}</span></p>}
    <Confirmation key={selected}>Revisé el ID y los grupos de referencia. Confirmo que es la misma persona y que quiero corregir únicamente este grupo. El historial anterior se conservará.</Confirmation>
  </ActionForm>;
}
