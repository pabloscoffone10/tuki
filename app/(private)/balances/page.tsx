import { Suspense } from "react";
import { PersonalBalances } from "@/features/finance/components/personal-balances";
export const metadata = { title: "Balances" };
export default function BalancesPage() {
  return <div className="space-y-6"><h1 className="text-3xl font-semibold">Balances</h1><Suspense fallback={<p>Cargando balances…</p>}><PersonalBalances/></Suspense></div>;
}
