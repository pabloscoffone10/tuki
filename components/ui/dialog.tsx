"use client";
import type { ComponentProps } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export function DialogTitle({className,...props}:ComponentProps<typeof DialogPrimitive.Title>){return <DialogPrimitive.Title className={cn("pr-10",className)} {...props}/>;}
export const DialogDescription = DialogPrimitive.Description;
export function DialogContent({ children, className, ...props }: ComponentProps<typeof DialogPrimitive.Content>) {
  return <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-xs data-[state=open]:animate-in data-[state=open]:fade-in-0" />
    <DialogPrimitive.Content className={cn("fixed top-1/2 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-contain -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-card p-5 sm:p-7 text-card-foreground shadow-xl outline-none", className)} {...props}>
      {children}
      <DialogPrimitive.Close className="absolute top-2 right-2 flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" aria-hidden="true" /><span className="sr-only">Cerrar</span></DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>;
}
