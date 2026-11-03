import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
export function EmptyState({ icon: Icon, title, description, action, className }: { icon: LucideIcon; title: string; description: string; action?: ReactNode; className?: string }) {
  return <div className={cn("flex flex-col items-center px-5 py-12 text-center", className)}><div className="mb-5 flex size-14 items-center justify-center rounded-2xl border bg-background shadow-xs"><Icon className="size-6 text-muted-foreground" aria-hidden="true" /></div><h3 className="text-sm font-semibold">{title}</h3><p className="mt-2 max-w-xs text-xs leading-6 text-muted-foreground">{description}</p>{action && <div className="mt-5">{action}</div>}</div>;
}
