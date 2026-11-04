import type {ReactNode} from "react";
import type {SmartItem} from "../domain";
export function groupProducts(items:SmartItem[],membership:Record<string,string>={}):SmartItem[][]{
 const groups=new Map<string,SmartItem[]>();
 for(const item of items){const key=membership[item.id]??item.id;const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
 return [...groups.values()];
}
export function ProductGroup({items,children}:{items:SmartItem[];children:ReactNode}){
 if(items.length===1)return children;
 const unassigned=items.filter(item=>!item.consumers.length).length;
 return <details open className="rounded-xl border bg-muted/10 p-3"><summary className="min-h-11 cursor-pointer text-sm font-medium">{items[0].name.replace(/ \d+$/,"")} · {items.length} unidades{unassigned?` · ${unassigned} sin asignar`:""}</summary><div className="space-y-3 pt-3">{children}</div></details>;
}
