import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
export function SectionPage({ title, description, icon, emptyTitle, emptyDescription, note }: { title: string; description: string; icon: LucideIcon; emptyTitle: string; emptyDescription: string; note: string }) {
  return <div className="space-y-7"><div><Badge className="mb-4 text-muted-foreground">Próximamente</Badge><h1 className="text-3xl font-semibold tracking-tight">{title}</h1><p className="mt-2 text-sm text-muted-foreground">{description}</p></div><Card><EmptyState icon={icon} title={emptyTitle} description={emptyDescription} className="min-h-80 justify-center" /></Card><p className="max-w-2xl text-xs leading-6 text-muted-foreground">{note}</p></div>;
}
