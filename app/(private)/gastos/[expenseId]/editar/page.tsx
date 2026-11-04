import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import Link from "next/link";
import { expenseDetail } from "@/features/finance/data";
import { ExpenseForm } from "@/features/finance/components/expense-form";
import { FinanceFailure } from "@/features/finance/components/views";
import { SmartBillForm } from "@/features/smart-bills/components/smart-bill-form";
import { aiConfigured } from "@/features/smart-bills/provider";
export const metadata={title:"Editar gasto"};
async function Content({params}:PageProps<"/gastos/[expenseId]/editar">){const {expenseId}=await params;if(!z.uuid().safeParse(expenseId).success)notFound();let e;try{e=await expenseDetail(expenseId);}catch(error){return <FinanceFailure error={error}/>;}if(e.payment_locked)return <p>Este gasto tiene pagos confirmados asociados a sus pares de personas. Revertí esos pagos con autorización antes de editarlo.</p>;if(!e.can_edit||e.archived||e.status!=="active")return <p>No se puede editar este gasto.</p>;return <div className="w-full space-y-6"><Link className="text-sm text-primary" href={`/gastos/${e.id}`}>← Volver al gasto</Link><h1 className="text-3xl font-semibold">Editar gasto</h1><p className="text-sm text-muted-foreground">Se guardará una nueva versión; la anterior se conserva.</p>{e.smartBill?<SmartBillForm id={e.id} groupId={e.group_id} people={e.people} initial={e} bill={e.smartBill} aiAvailable={aiConfigured()}/>:<ExpenseForm id={e.id} groupId={e.group_id} people={e.people} initial={e}/>}</div>;}
export default function Page(props:PageProps<"/gastos/[expenseId]/editar">){return <Suspense fallback={<p>Cargando…</p>}><Content {...props}/></Suspense>;}
