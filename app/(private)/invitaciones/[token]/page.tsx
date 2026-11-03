import { Suspense } from "react";
import { notFound } from "next/navigation";
import { UsersRound } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acceptInvitation } from "@/features/groups/actions";
import { tokenSchema } from "@/features/groups/schemas";
import { ActionForm } from "@/features/groups/components/action-form";
import { Confirmation } from "@/features/groups/components/fields";
export const metadata = { title: "Invitación a un grupo", robots: { index: false, follow: false } };
async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) notFound();
  return <Card className="mx-auto max-w-lg"><CardHeader><UsersRound className="mb-3 size-8 text-primary" aria-hidden="true" /><CardTitle>Te invitaron a compartir un grupo</CardTitle></CardHeader><CardContent className="space-y-5"><p className="text-sm leading-7 text-muted-foreground">Al aceptar, vas a unirte con la identidad global de tu cuenta. No vas a reclamar ni reemplazar a un invitado existente. El enlace debe seguir vigente y disponible.</p><ActionForm action={acceptInvitation} label="Aceptar invitación"><input type="hidden" name="token" value={token} /><Confirmation>Quiero unirme con mi propia cuenta. Conozco a la persona que me compartió este enlace.</Confirmation></ActionForm></CardContent></Card>;
}
export default function InvitationPage({ params }: PageProps<"/invitaciones/[token]">) {
  return <Suspense fallback={<p role="status">Preparando la invitación…</p>}><Invitation params={params} /></Suspense>;
}
