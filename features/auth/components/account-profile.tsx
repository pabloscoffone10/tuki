import Link from "next/link";
import { requireUser } from "@/features/auth/session";
import { createReadOnlyClient } from "@/lib/supabase/server";
import type { AccountProfile as Profile } from "@/features/auth/profile";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export async function AccountProfile() {
  const user = await requireUser();
  const supabase = await createReadOnlyClient();
  const { data: profile, error } = await supabase.from("profiles").select("user_id, display_name, created_at").eq("user_id", user.id).maybeSingle<Profile>();
  return <Card><CardHeader><CardTitle>Tu cuenta</CardTitle></CardHeader><CardContent className="space-y-4 text-sm">
    <dl className="space-y-3"><div><dt className="text-xs text-muted-foreground">Nombre</dt><dd className="mt-1">{profile?.display_name || "Sin nombre configurado"}</dd></div><div><dt className="text-xs text-muted-foreground">Email</dt><dd className="mt-1 break-all">{user.email || "Sin email"}</dd></div></dl>
    {(error || !profile) && <p className="rounded-lg border p-3 text-xs leading-6 text-muted-foreground">Tu sesión está activa. El perfil todavía no está disponible: aplicá la migración de la Fase 2 indicada en la documentación.</p>}
    <Button asChild variant="outline"><Link href="/actualizar-contrasena">Cambiar contraseña</Link></Button>
  </CardContent></Card>;
}
