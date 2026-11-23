import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ExpenseView } from "@/features/finance/components/views";
export const metadata={title:"Detalle del gasto"};
async function Content({params,searchParams}:PageProps<"/gastos/[expenseId]">){const [{expenseId},query]=await Promise.all([params,searchParams]);if(!z.uuid().safeParse(expenseId).success)notFound();return <ExpenseView id={expenseId} saved={query.guardado==="1"}/>;}
export default function Page(props:PageProps<"/gastos/[expenseId]">){return <Suspense fallback={<p>Cargando gasto…</p>}><Content {...props}/></Suspense>;}
