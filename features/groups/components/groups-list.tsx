import { GroupCardMenu } from "./group-card-menu";
import { Avatar } from "@/features/avatars/avatar";
import { requireUser } from "@/features/auth/session";
import Link from "next/link";
import { Archive, Plus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { listGroups } from "../data";
import { formatGroupDate } from "../format";
import { createReadOnlyClient } from "@/lib/supabase/server";
import { ActionForm } from "./action-form";
import { Confirmation } from "./fields";
import { safeRemoval } from "@/features/finance/actions";
import { z } from "zod";

export async function GroupsList({cleanupId,deleted=false}:{cleanupId?:string;deleted?:boolean}={}) {
  const { groups, error } = await listGroups();
  const user=await requireUser();
  const client=await createReadOnlyClient();
  const {data:person}=await client.from("persons").select("id").eq("user_id",user.id).maybeSingle<{id:string}>();
  const {data:memberships}=person?await client.from("group_members").select("group_id,role,status").eq("person_id",person.id):{data:[]};
  const permission=(id:string)=>memberships?.find(m=>m.group_id===id&&m.status==="active");
  let pending=false;
  if(z.uuid().safeParse(cleanupId).success){
    try{const client=await createReadOnlyClient();const status=await client.rpc("tuki_group_deletion_status",{p_group_id:cleanupId!});pending=!status.error&&status.data>0;}catch{/* Keep the group list available. */}
  }
  return <div className="space-y-7"><div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">Mis grupos</h1><p className="mt-2 text-sm text-muted-foreground">Tu gente, tus planes. Una identidad en todos tus grupos.</p></div><Button asChild><Link href="/grupos/nuevo"><Plus aria-hidden="true" />Crear grupo</Link></Button></div>
    {deleted&&<p role="status" className="rounded-xl border p-4 text-sm">Grupo eliminado definitivamente.</p>}
    {pending&&<Card className="p-5"><p role="status" className="mb-4 text-sm">El grupo y sus movimientos se eliminaron. Queda pendiente borrar archivos privados del almacenamiento. Reintentá la limpieza; si continúa, el servidor necesita revisar Storage y SUPABASE_SERVICE_ROLE_KEY.</p><ActionForm action={safeRemoval} label="Reintentar limpieza de archivos" variant="outline"><input type="hidden" name="mode" value="group"/><input type="hidden" name="id" value={cleanupId}/><Confirmation>Confirmo el borrado permanente de los archivos pendientes de este grupo eliminado.</Confirmation></ActionForm></Card>}
    {error ? <p role="alert" className="rounded-xl border bg-card p-6 text-sm leading-7 text-destructive">{error}</p> : groups.length === 0 ? <Card><EmptyState icon={UsersRound} title="Todo empieza con un grupo" description="Creá un espacio para tu próxima salida o tus planes de siempre. Después podés sumar invitados o enviar enlaces para unirse." action={<Button asChild><Link href="/grupos/nuevo">Crear mi primer grupo</Link></Button>} /></Card> : <>
      {[false, true].map((archived) => <section key={String(archived)} className="space-y-4" aria-label={archived ? "Grupos archivados" : "Grupos activos"}>
        <h2 className="flex items-center gap-2 text-sm font-semibold">{archived && <Archive className="size-4" aria-hidden="true" />}{archived ? "Archivados" : "Activos"}<Badge>{groups.filter((group) => !!group.archived_at === archived).length}</Badge></h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{groups.filter((group) => !!group.archived_at === archived).map((group) => <Card key={group.id} className="h-full p-5 transition-colors hover:border-primary/40"><div className="flex items-start justify-between gap-3"><Avatar kind="group" targetId={group.id} name={group.name}/><GroupCardMenu groupId={group.id} name={group.name} admin={permission(group.id)?.role==="admin"} owner={!!permission(group.id)&&group.created_by===person?.id} archived={archived}/></div><Link href={`/grupos/${group.id}`} className="mt-3 block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"><h3 className="truncate text-lg font-semibold">{group.name}</h3><p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-muted-foreground">{group.description || "Un espacio para compartir buenos planes."}</p><div className="mt-5 flex flex-wrap gap-2"><Badge>{group.kind === "permanent" ? "Permanente" : "Temporal"}</Badge>{archived && <Badge>Archivado</Badge>}</div><p className="mt-4 text-[11px] text-muted-foreground">Creado el {formatGroupDate(group.created_at)}</p><span className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-primary">Abrir grupo</span></Link></Card>)}</div>
        {!groups.some((group) => !!group.archived_at === archived) && <p className="text-xs text-muted-foreground">No hay grupos {archived ? "archivados" : "activos"}.</p>}
      </section>)}
    </>}
  </div>;
}
