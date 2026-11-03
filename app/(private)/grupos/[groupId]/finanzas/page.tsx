import { Suspense } from "react";
import { redirect,notFound } from "next/navigation";
import { idSchema } from "@/features/groups/schemas";
export const metadata={title:"Saldos del grupo"};
async function Content({params}:PageProps<"/grupos/[groupId]/finanzas">){const {groupId}=await params;if(!idSchema.safeParse(groupId).success)notFound();return redirect(`/grupos/${groupId}?seccion=saldos`);}
export default function Page(props:PageProps<"/grupos/[groupId]/finanzas">){return <Suspense fallback={<p>Cargando saldos...</p>}><Content {...props}/></Suspense>;}
