"use client";
import {useEffect,useRef,useState} from "react";
import {Button} from "@/components/ui/button";
import {Dialog,DialogTrigger,DialogContent,DialogTitle,DialogDescription} from "@/components/ui/dialog";
import {ReceiptText} from "lucide-react";

export function ReceiptImagePreview({file}:{file:File|null}){
 const imageRef=useRef<HTMLImageElement>(null);
 const objectUrlRef=useRef<string|null>(null);
 const [zoom,setZoom]=useState(100);
 const [open,setOpen]=useState(false);
 useEffect(()=>{
  if(!open||!file||!file.type.startsWith("image/")||!URL.createObjectURL)return;
  const objectUrl=URL.createObjectURL(file);objectUrlRef.current=objectUrl;if(imageRef.current)imageRef.current.src=objectUrl;
  return()=>{objectUrlRef.current=null;URL.revokeObjectURL(objectUrl);};
 },[file,open]);
 if(!file||!file.type.startsWith("image/"))return null;
 return <div className="flex justify-end"><Dialog open={open} onOpenChange={value=>{setOpen(value);if(value)setZoom(100);}}>
  <DialogTrigger asChild><Button type="button" size="sm" variant="ghost" className="gap-2 text-muted-foreground"><ReceiptText className="size-4" aria-hidden="true"/>Ver ticket</Button></DialogTrigger>
  <DialogContent className="flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-4xl flex-col gap-3 overflow-hidden p-3 sm:h-[90dvh] sm:p-5">
   <div className="min-w-0 pr-9"><DialogTitle className="text-base font-semibold">Ticket original</DialogTitle><DialogDescription className="mt-1 truncate text-xs text-muted-foreground">{file.name}. Consultá la foto sin perder las correcciones.</DialogDescription></div>
   <div className="flex shrink-0 items-center gap-2 border-b pb-3"><Button type="button" size="sm" variant="outline" aria-label="Alejar ticket" disabled={zoom<=100} onClick={()=>setZoom(old=>Math.max(100,old-25))}>−</Button><span className="min-w-20 text-center text-xs tabular-nums" aria-live="polite">Zoom {zoom}%</span><Button type="button" size="sm" variant="outline" aria-label="Acercar ticket" disabled={zoom>=300} onClick={()=>setZoom(old=>Math.min(300,old+25))}>+</Button><Button type="button" size="sm" variant="ghost" onClick={()=>setZoom(100)}>Ajustar</Button></div>
   <div className="min-h-0 flex-1 overflow-auto overscroll-contain rounded-lg bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" tabIndex={0} aria-label="Vista ampliable del ticket">
    {/* Object URL is local and private; preserve the original image for comparison. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img ref={element=>{imageRef.current=element;if(element&&objectUrlRef.current)element.src=objectUrlRef.current;}} alt="Ticket original para revisar productos e importes" className="h-auto max-w-none" style={{width:`${zoom}%`}}/>
   </div>
  </DialogContent>
 </Dialog></div>;
}
