import { Suspense } from "react";
import { BalanceCards, PersonalBalances } from "@/features/finance/components/views";
export const metadata = { title: "Balances" };
export default function BalancesPage() {
  return <div className="space-y-6"><h1 className="text-3xl font-semibold">Balances</h1><p className="text-sm text-muted-foreground">Tus cuentas globales, siempre en UYU. No sumamos proyecciones de distintos grupos.</p><Suspense fallback={<p>Cargando balances…</p>}><BalanceCards/><PersonalBalances/></Suspense></div>;
}
