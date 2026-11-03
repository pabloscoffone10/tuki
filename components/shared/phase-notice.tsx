"use client";
import { ArrowRight, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
export function PhaseNotice({ label = "Cómo empezar" }: { label?: string }) {
  return <Dialog><DialogTrigger asChild><Button>{label}<ArrowRight aria-hidden="true" /></Button></DialogTrigger><DialogContent><div className="mb-5 flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><Sprout aria-hidden="true" /></div><DialogTitle className="text-xl font-semibold tracking-tight">Tu próximo encuentro empieza acá</DialogTitle><DialogDescription className="mt-3 text-sm leading-7 text-muted-foreground">Creá un grupo, reutilizá las identidades globales de tus amigos y cargá gastos con repartos exactos. En cada grupo podés distinguir sus gastos propios de las deudas compartidas desde otros grupos.</DialogDescription><p className="mt-4 rounded-lg border bg-muted/50 p-3 text-xs leading-6 text-muted-foreground">La cotización manual queda fijada por gasto y los balances se muestran en UYU. Los pagos se registran fuera de Tuki y solo reducen deudas al confirmarse. Los pagos pendientes y rechazados no cambian el saldo.</p><DialogClose asChild><Button className="mt-6 w-full">Entendido</Button></DialogClose></DialogContent></Dialog>;
}
