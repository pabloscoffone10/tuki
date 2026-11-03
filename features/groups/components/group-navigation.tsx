import Link from "next/link";
import { Settings2 } from "lucide-react";
const sections=[['resumen','Resumen'],['gastos','Gastos'],['saldos','Saldos'],['personas','Personas']] as const;
export type GroupSection=typeof sections[number][0]|'ajustes';
export function groupSection(value:unknown):GroupSection{return typeof value==='string'&&[...sections.map(([id])=>id),'ajustes'].includes(value)?value as GroupSection:'resumen';}
export function GroupNavigation({groupId,section,admin}:{groupId:string;section:GroupSection;admin:boolean}){
 return <div className="flex flex-col gap-2 border-b pb-3 sm:flex-row sm:items-center"><nav aria-label="Secciones del grupo" className="grid flex-1 grid-cols-4 gap-1">{sections.map(([id,label])=><Link key={id} prefetch={false} scroll={false} href={`/grupos/${groupId}?seccion=${id}`} aria-current={section===id?'page':undefined} className={`flex min-h-11 items-center justify-center rounded-lg px-1 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm ${section===id?'bg-primary/10 text-primary':'text-muted-foreground hover:bg-accent'}`}>{label}</Link>)}</nav><Link scroll={false} href={`/grupos/${groupId}?seccion=ajustes`} aria-current={section==='ajustes'?'page':undefined} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><Settings2 className="size-4" aria-hidden="true"/>{admin?'Ajustes e historial':'Historial del grupo'}</Link></div>;
}
