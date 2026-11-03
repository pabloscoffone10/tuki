import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getGroup } from "@/features/groups/data";
import { idSchema } from "@/features/groups/schemas";
import { ExpenseComposer } from "@/features/smart-bills/components/expense-composer";
import { aiConfigured } from "@/features/smart-bills/provider";
export const metadata={title:"Nuevo gasto"};
async function Content({params}:PageProps<"/grupos/[groupId]/gastos/nuevo">){const {groupId}=await params;if(!idSchema.safeParse(groupId).success)notFound();const result=await getGroup(groupId,{people:false,invitations:false,events:false});if(result.notFound)notFound();if(!result.group)return <p role="alert">{result.error}</p>;if(result.group.archived_at)return <p>Desarchivá el grupo antes de crear un gasto.</p>;return <div className="mx-auto max-w-3xl space-y-6"><Link className="text-sm text-primary" href={`/grupos/${groupId}/finanzas`}>← {result.group.name}</Link><h1 className="text-3xl font-semibold">Nuevo gasto</h1><ExpenseComposer currentPersonId={result.me?.person_id} aiAvailable={aiConfigured()} id={randomUUID()} groupId={groupId} people={result.members.map(m=>({id:m.person_id,name:m.person?.display_name??"Identidad restringida",status:m.status,replaced:!!m.replaced_by_person_id}))}/></div>;}
export default function Page(props:PageProps<"/grupos/[groupId]/gastos/nuevo">){return <Suspense fallback={<p>Cargando participantes…</p>}><Content {...props}/></Suspense>;}
