import { Suspense } from "react";
import { FinancialHistory } from "@/features/reports/history";
export const metadata = { title: "Actividad" };
export default function ActivityPage({searchParams}:PageProps<"/actividad">) {
  return <div className="space-y-6"><h1 className="text-3xl font-semibold">Actividad</h1><p className="text-sm text-muted-foreground">Gastos y pagos autorizados: registro, edición, confirmación, rechazo y reversión.</p><Suspense fallback={<p>Cargando actividad…</p>}><FinancialHistory searchParams={searchParams}/></Suspense></div>;
}
