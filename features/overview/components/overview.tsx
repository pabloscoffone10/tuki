import Link from "next/link";
import { ArrowRight, Layers3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { BalanceCards, ExpenseList } from "@/features/finance/components/views";
import { PhaseNotice } from "@/components/shared/phase-notice";
import { Suspense } from "react";
import { GroupsPreviewContent } from "@/features/groups/components/groups-preview";
import { listGroups } from "@/features/groups/data";
import { PersonalStatisticsPanel } from "@/features/reports/statistics";

export async function Overview() {
  const {groups,error}=await listGroups();const isNew=!error&&!groups.length;
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="mb-2 text-[10px] font-semibold tracking-[0.17em] text-muted-foreground">MENOS CUENTAS. MÁS MOMENTOS.</p><h1 className="text-3xl font-semibold tracking-[-1.2px] sm:text-[34px]">Todo en su lugar.</h1><p className="mt-2 text-sm text-muted-foreground">Tu espacio para compartir gastos y seguir disfrutando.</p></div>{isNew?<PhaseNotice />:<Button asChild variant="outline"><Link href="/grupos">Ver mis grupos<ArrowRight aria-hidden="true"/></Link></Button>}</div>
    {isNew&&<section aria-labelledby="welcome-title" className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-5"><h2 id="welcome-title" className="text-xl font-semibold">Creá un grupo para tu próximo plan</h2><ol className="grid gap-3 text-sm sm:grid-cols-3"><li>1. Creá un grupo para tu plan.</li><li>2. Sumá personas o reutilizá tus invitados.</li><li>3. Cargá un gasto y revisá el reparto.</li></ol><Button asChild><Link href="/grupos/nuevo">Crear grupo<ArrowRight aria-hidden="true"/></Link></Button><p className="text-xs text-muted-foreground">No necesitás que todos tengan cuenta para empezar. Los pagos se realizan fuera de Tuki.</p></section>}
    <Suspense fallback={<p>Cargando balances…</p>}><BalanceCards /></Suspense>
    <details className="rounded-xl border bg-card p-5"><summary className="min-h-11 cursor-pointer text-sm font-medium">Tu consumo, adelantos y liquidaciones</summary><div className="mt-4"><Suspense fallback={<p>Cargando tu participación…</p>}><PersonalStatisticsPanel/></Suspense></div></details>
    <div className="grid gap-6 xl:grid-cols-[1.35fr_1fr]">
      <Card><CardHeader className="flex-row items-start justify-between"><div><CardTitle>Mis grupos</CardTitle><CardDescription className="mt-1">Cada plan tiene su lugar.</CardDescription></div><Button asChild variant="ghost" size="sm" className="-mr-2 text-xs"><Link href="/grupos">Ver grupos<ArrowRight aria-hidden="true" /></Link></Button></CardHeader><CardContent><Suspense fallback={<p role="status" className="py-10 text-center text-xs text-muted-foreground">Cargando tus grupos…</p>}><GroupsPreviewContent groups={groups} error={error}/></Suspense></CardContent></Card>
      <Card><CardHeader><CardTitle>Últimos movimientos</CardTitle><CardDescription>Los detalles, sin perder el hilo.</CardDescription></CardHeader><CardContent><Suspense fallback={<p>Cargando gastos…</p>}><ExpenseList /></Suspense></CardContent></Card>
    </div>
    <section aria-labelledby="shared-title" className="flex flex-col gap-5 rounded-xl border bg-card p-6 sm:flex-row sm:items-center"><span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary"><Layers3 className="size-5" aria-hidden="true" /></span><div className="flex-1"><h2 id="shared-title" className="text-sm font-semibold">Varios grupos. Una sola cuenta entre ustedes.</h2><p className="mt-1.5 max-w-2xl text-xs leading-6 text-muted-foreground">Las deudas entre dos personas se verán en los grupos que comparten, conservando su origen y sin sumar el importe dos veces.</p></div><Button asChild variant="ghost" size="sm" className="self-start text-primary sm:self-auto"><Link href="/balances">Sobre los balances<ArrowRight aria-hidden="true" /></Link></Button></section>
  </div>;
}
