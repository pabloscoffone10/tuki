import {useState} from "react";
import type {SmartItem} from "../domain";
import type {LineEvidence} from "../review-checks";
import {Field,inputClass} from "@/features/groups/components/fields";
import {Button} from "@/components/ui/button";
export function CorrectUnits({item,evidence,onCorrect,onRemove}:{item:SmartItem;evidence?:LineEvidence;onCorrect:(quantity:string,unitPrice:string)=>void;onRemove:()=>void}){
 const [quantity,setQuantity]=useState(item.quantity),[price,setPrice]=useState(item.priceMode==="unit"?item.price:evidence?.unitPrice??"");
 return <section className="space-y-3 rounded-xl border border-amber-500/40 bg-card p-4"><h3 className="font-medium">{item.name||"Producto por corregir"}</h3><p className="text-xs text-amber-800 dark:text-amber-200">Revisá cuántas unidades hay y su precio con el ticket. Importe leído: {item.price}.</p><div className="grid gap-3 sm:grid-cols-2"><Field label="Cantidad a separar"><input className={inputClass} inputMode="numeric" value={quantity} onChange={e=>setQuantity(e.target.value)}/></Field><Field label="Precio de cada unidad"><input className={inputClass} inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/></Field></div><Button type="button" variant="outline" onClick={()=>onCorrect(quantity,price)}>Aplicar corrección</Button><Button type="button" variant="ghost" onClick={onRemove}>Eliminar producto</Button></section>;
}
