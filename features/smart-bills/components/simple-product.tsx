import type {SmartItem} from "../domain";
import type {FinancePerson} from "@/features/finance/types";
import {Field,inputClass} from "@/features/groups/components/fields";
import {Button} from "@/components/ui/button";
export function SimpleProduct({item,index,people,issue,doubtful,quantityEditable=true,unitPrice,onUnitPriceChange,onChange,onRemove}:{item:SmartItem;index:number;people:FinancePerson[];issue?:string;doubtful?:boolean;quantityEditable?:boolean;unitPrice?:string;onUnitPriceChange?:(value:string)=>void;onChange:(patch:Partial<SmartItem>)=>void;onRemove:()=>void}){
 return <section aria-label={`Producto ${index+1}`} className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
 <div className="grid grid-cols-[1fr_8rem] gap-3"><Field label="Producto"><input className={`${inputClass} ${doubtful?"border-amber-500/50":""}`} value={item.name} maxLength={120} onChange={e=>onChange({name:e.target.value})}/></Field><Field label="Precio"><input className={inputClass} inputMode="decimal" value={item.price} onChange={e=>onChange({price:e.target.value})}/></Field></div>
 <Field label="Cantidad"><input className={inputClass} inputMode="decimal" value={item.quantity} placeholder="Pendiente de corrección" disabled={!quantityEditable} onChange={e=>onChange({quantity:e.target.value})}/></Field>
 {quantityEditable&&onUnitPriceChange&&<Field label="Precio unitario leído (opcional)"><input className={inputClass} inputMode="decimal" value={unitPrice??""} placeholder="Pendiente de corrección" onChange={e=>onUnitPriceChange(e.target.value)}/></Field>}
 <p className="text-xs text-muted-foreground">El precio es el importe total de esta fila; se divide por igual entre las personas elegidas.</p>
 {issue&&<p role="alert" className="rounded-lg bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">{issue}</p>}
 <p className="text-xs font-medium">¿Quién lo consumió?</p><div className="flex flex-wrap gap-2">{people.map(person=>{const selected=item.consumers.some(p=>p.personId===person.id);return <button type="button" key={person.id} aria-pressed={selected} onClick={()=>onChange({split:"equal",consumers:selected?item.consumers.filter(p=>p.personId!==person.id):[...item.consumers,{personId:person.id,input:"1"}]})} className={`min-h-11 rounded-full border px-4 text-sm transition-colors ${selected?"border-primary bg-primary/15 font-medium text-primary":"border-border hover:bg-muted"}`}>{person.name}</button>;})}</div>
 {!item.consumers.length&&<p className="text-xs text-amber-700 dark:text-amber-300">Sin asignar: elegí quién lo consumió.</p>}
 <Button type="button" size="sm" variant="ghost" onClick={onRemove}>Eliminar producto</Button></section>;
}

