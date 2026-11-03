import { createGroup, updateGroup } from "../actions";
import type { Group } from "../types";
import { ActionForm } from "./action-form";
import { Field, inputClass } from "./fields";
export function GroupForm({ group }: { group?: Group }) {
  return <ActionForm action={group ? updateGroup : createGroup} label={group ? "Guardar cambios" : "Crear grupo"}>
    {group && <input type="hidden" name="groupId" value={group.id} />}
    <Field label="Nombre del grupo"><input name="name" required maxLength={80} defaultValue={group?.name} className={inputClass} placeholder="Por ejemplo, nuestro próximo viaje" /></Field>
    <Field label="Descripción (opcional)"><textarea name="description" maxLength={1000} defaultValue={group?.description || ""} className={`${inputClass} min-h-24 py-3`} /></Field>
    <Field label="Tipo de grupo"><select name="kind" defaultValue={group?.kind || "permanent"} className={inputClass}><option value="permanent">Permanente · para los planes de siempre</option><option value="temporary">Temporal · para una ocasión</option></select></Field>
    <p className="text-xs text-muted-foreground">Moneda de las operaciones nuevas: UYU · pesos uruguayos. Única moneda habilitada durante la beta; el historial existente se conserva.</p>
    {!group && <p className="text-xs leading-6 text-muted-foreground">Vas a ser administrador y primer participante. Los grupos temporales también se archivan manualmente; su historial se conserva.</p>}
  </ActionForm>;
}
