import type {ReactNode} from "react";
import {ChevronDown,Info} from "lucide-react";

export function OcrWarnings({messages,children}:{messages:string[];children?:ReactNode}){
 const unique=[...new Set(messages.filter(Boolean))];
 if(!unique.length&&!children)return null;
 return <details className="group rounded-lg border border-border/80 bg-muted/20 text-xs">
  <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden"><Info className="size-4 shrink-0 text-primary" aria-hidden="true"/><span className="flex-1 font-medium">{unique.length?`${unique.length} ${unique.length===1?"punto":"puntos"} para revisar`:"Comprobaciones OCR"}</span><span className="text-muted-foreground group-open:hidden">Ver detalles</span><span className="hidden text-muted-foreground group-open:inline">Ocultar detalles</span><ChevronDown className="size-3.5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true"/></summary>
  <div className="space-y-3 border-t px-3 py-3">{children}{unique.length>0&&<ul className="space-y-2 text-muted-foreground">{unique.map(message=><li key={message} className="leading-5">{message}</li>)}</ul>}</div>
 </details>;
}
