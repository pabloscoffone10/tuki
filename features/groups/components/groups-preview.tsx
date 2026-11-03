import Link from "next/link";
import { UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/empty-state";
import type { Group } from "../types";
import { listGroups } from "../data";

export async function GroupsPreview() {
  const { groups, error } = await listGroups();
  return <GroupsPreviewContent groups={groups} error={error}/>;
}
export function GroupsPreviewContent({groups,error}:{groups:Group[];error?:string}){
  if (error) return <p role="alert" className="text-sm leading-6 text-destructive">{error}</p>;
  if (!groups.length) return <div className="rounded-xl border border-dashed bg-background/50"><EmptyState icon={UsersRound} title="Un grupo, muchos buenos planes" description="Creá tu primer grupo e invitá a tu gente. Cada persona puede participar en varios grupos con la misma identidad." action={<Button asChild variant="outline"><Link href="/grupos/nuevo"><UsersRound aria-hidden="true" />Crear grupo</Link></Button>} /></div>;
  return <div className="space-y-3">{groups.slice(0, 3).map((group) => <Link key={group.id} href={`/grupos/${group.id}`} className="flex items-center justify-between gap-3 rounded-xl border p-4 transition-colors hover:bg-accent"><div className="min-w-0"><p className="truncate text-sm font-semibold">{group.name}</p><p className="mt-1 text-xs text-muted-foreground">{group.kind === "permanent" ? "Permanente" : "Temporal"}</p></div><Badge>{group.archived_at ? "Archivado" : "Activo"}</Badge></Link>)}<Button asChild variant="outline" className="mt-2"><Link href="/grupos/nuevo">Crear otro grupo</Link></Button></div>;
}
