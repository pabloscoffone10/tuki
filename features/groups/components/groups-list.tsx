import Link from "next/link";
import { ArrowUpRight, Archive, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { listGroups } from "../data";
import { formatGroupDate } from "../format";

export async function GroupsList() {
  const { groups, error } = await listGroups();
  return <div className="space-y-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Mis grupos</h1><p className="mt-2 text-sm text-muted-foreground">Tu gente, tus planes. Una identidad en todos tus grupos.</p></div><Button asChild><Link href="/grupos/nuevo"><Plus aria-hidden="true" />Crear grupo</Link></Button></div>
    {error ? <p role="alert" className="rounded-xl border bg-card p-6 text-sm leading-7 text-destructive">{error}</p> : groups.length === 0 ? <Card><EmptyState icon={UsersRound} title="Todo empieza con un grupo" description="Creá un espacio para tu próxima salida o tus planes de siempre. Después podés sumar invitados o enviar enlaces para unirse." action={<Button asChild><Link href="/grupos/nuevo">Crear mi primer grupo</Link></Button>} /></Card> : <>
      {[false, true].map((archived) => <section key={String(archived)} className="space-y-4" aria-label={archived ? "Grupos archivados" : "Grupos activos"}>
        <h2 className="flex items-center gap-2 text-sm font-semibold">{archived && <Archive className="size-4" aria-hidden="true" />}{archived ? "Archivados" : "Activos"}<Badge>{groups.filter((group) => !!group.archived_at === archived).length}</Badge></h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.filter((group) => !!group.archived_at === archived).map((group) => <Link key={group.id} href={`/grupos/${group.id}`} className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"><Card className="h-full p-6 transition-colors hover:border-primary/40"><div className="flex items-start justify-between gap-3"><span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><UsersRound className="size-5" aria-hidden="true" /></span><ArrowUpRight className="size-4 text-muted-foreground" aria-hidden="true" /></div><h3 className="mt-5 truncate text-lg font-semibold">{group.name}</h3><p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{group.description || "Un espacio para compartir buenos planes."}</p><div className="mt-5 flex flex-wrap gap-2"><Badge>{group.kind === "permanent" ? "Permanente" : "Temporal"}</Badge>{archived && <Badge>Archivado</Badge>}</div><p className="mt-4 text-[11px] text-muted-foreground">Creado el {formatGroupDate(group.created_at)}</p></Card></Link>)}</div>
        {!groups.some((group) => !!group.archived_at === archived) && <p className="text-xs text-muted-foreground">No hay grupos {archived ? "archivados" : "activos"}.</p>}
      </section>)}
    </>}
  </div>;
}
