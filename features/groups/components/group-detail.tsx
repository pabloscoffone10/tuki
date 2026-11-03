import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getGroup } from "../data";
import { idSchema } from "../schemas";
import { formatGroupDate } from "../format";
import { GroupPeople } from "./group-people";
import { GroupSettings } from "./group-settings";
import { GroupNavigation,groupSection } from "./group-navigation";
import { GroupDebtControl } from "@/features/payments/components/workspace";
import { GroupFinance } from "@/features/finance/components/views";
import { ExpenseBrowser } from "@/features/reports/expense-browser";
import { FinancialHistory } from "@/features/reports/history";
import { GroupStatisticsPanel } from "@/features/reports/statistics";
import type { ReportSearch } from "@/features/reports/types";
export async function GroupDetail({params,searchParams=Promise.resolve({})}:{params:Promise<{groupId:string}>;searchParams?:Promise<ReportSearch>}){
 const [{groupId},query]=await Promise.all([params,searchParams]);if(!idSchema.safeParse(groupId).success)notFound();const section=groupSection(query.seccion);
 const result=await getGroup(groupId,{people:section==="personas",invitations:section==="ajustes",events:section==="ajustes"});
 if(result.notFound)notFound();if(!result.group)return <p role="alert" className="rounded-xl border bg-card p-6 text-sm text-destructive">{result.error}</p>;
 const {group,members,admin,me,userId,people,replacementPeople=[],invitations,events}=result;const archived=!!group.archived_at;
  return <div className="space-y-7">
    <Link href="/grupos" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="size-3" aria-hidden="true" />Todos mis grupos</Link>
    <div><div className="mb-3 flex flex-wrap gap-2"><Badge>{group.kind === "permanent" ? "Permanente" : "Temporal"}</Badge><Badge>{archived ? "Archivado" : "Activo"}</Badge><Badge>{admin ? "Sos administrador" : "Sos miembro"}</Badge></div><h1 className="break-words text-3xl font-semibold tracking-tight">{group.name}</h1><p className="mt-3 max-w-2xl whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{group.description || "Un espacio para compartir, sin vueltas."}</p><p className="mt-3 text-xs text-muted-foreground">Creado el {formatGroupDate(group.created_at)}</p></div>
    {archived && <p role="status" className="rounded-xl border bg-card p-4 text-sm leading-7">Este grupo conserva sus participantes e historial. Las invitaciones y los cambios de integrantes están pausados hasta desarchivarlo.</p>}
    <div className="flex flex-wrap gap-3">{!archived&&<Button asChild className="w-full sm:w-auto"><Link href={`/grupos/${group.id}/gastos/nuevo`}>Nuevo gasto</Link></Button>}<Button asChild variant="outline"><Link href={`/pagos?grupo=${group.id}`}>Pagos y confirmaciones</Link></Button></div>
    <GroupNavigation groupId={group.id} section={section} admin={admin}/>
    {section==="resumen"&&<>{!archived&&members.filter(m=>m.status==="active").length<=1&&<div className="space-y-2 rounded-xl border bg-primary/5 p-4"><h2 className="text-sm font-semibold">Sumá a tu gente</h2><p className="text-sm text-muted-foreground">Desde Personas podés revisar quiénes comparten este grupo antes de cargar un gasto.</p><Link className="inline-flex min-h-11 items-center text-sm text-primary underline" href={`/grupos/${group.id}?seccion=personas`}>{admin?"Agregar personas":"Ver personas"}</Link></div>}<GroupDebtControl groupId={group.id} showSummary/></>}
    {section==="resumen"&&<GroupStatisticsPanel groupId={group.id} searchParams={searchParams}/>}
    {section==="gastos"&&<section className="space-y-4"><h2 className="text-xl font-semibold">Gastos del grupo</h2><ExpenseBrowser groupId={group.id} canCreate={!archived} searchParams={searchParams}/></section>}
    {section==="saldos"&&<GroupFinance groupId={group.id} ledgerOnly/>}
    {section==="personas"&&<GroupPeople group={group} members={members} admin={admin} me={me} userId={userId} people={people} replacementPeople={replacementPeople}/>}
    {section==="ajustes"&&<><FinancialHistory groupId={group.id} searchParams={searchParams}/><GroupSettings group={group} admin={admin} invitations={invitations} events={events}/></>}
  </div>;
}
