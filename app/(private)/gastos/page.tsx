import { Suspense } from "react";
import { ExpenseBrowser } from "@/features/reports/expense-browser";
export const metadata={title:"Gastos"};
export default function Page({searchParams}:PageProps<"/gastos">){return <div className="space-y-6"><h1 className="text-3xl font-semibold">Gastos</h1><p className="text-sm text-muted-foreground">Gastos de los grupos a los que tenés acceso activo. Para crear uno, entrá al grupo correspondiente.</p><Suspense fallback={<p>Cargando gastos…</p>}><ExpenseBrowser searchParams={searchParams}/></Suspense></div>;}
