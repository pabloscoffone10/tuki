import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { GroupForm } from "@/features/groups/components/group-form";
export const metadata = { title: "Crear grupo" };
export default function NewGroupPage() {
  return <div className="max-w-2xl space-y-6"><Link href="/grupos" className="inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"><ArrowLeft className="size-3" aria-hidden="true" />Mis grupos</Link><div><h1 className="text-3xl font-semibold tracking-tight">Un lugar para tu gente.</h1><p className="mt-3 text-sm text-muted-foreground">Creá el grupo. Los buenos planes vienen después.</p></div><Card><CardHeader><CardTitle>Crear grupo</CardTitle></CardHeader><CardContent><GroupForm /></CardContent></Card></div>;
}
