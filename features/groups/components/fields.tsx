import type { ReactNode } from "react";
export const inputClass = "h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2 text-sm font-medium"><span>{label}</span>{children}</label>;
}
export function Confirmation({ children }: { children: ReactNode }) {
  return <label className="flex min-h-11 items-start gap-3 py-2 text-sm leading-6 text-muted-foreground"><input type="checkbox" name="confirm" value="yes" required className="mt-1.5 accent-primary" /><span>{children}</span></label>;
}
