import Link from "next/link";
import { cn } from "@/lib/utils";
export function Brand({ className }: { className?: string }) {
  return <Link href="/" aria-label="Tuki, inicio" className={cn("inline-flex items-center gap-2.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring", className)}>
    <span className="flex size-9 items-center justify-center rounded-[11px] bg-primary text-primary-foreground" aria-hidden="true"><svg viewBox="0 0 32 32" className="size-7" fill="none"><path d="M9 8v10a7 7 0 0 0 14 0V8M16 8v16M6 12h6m8 0h6" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /></svg></span>
    <span className="text-[26px] font-semibold tracking-[-1.5px]">tuki<span className="text-primary">.</span></span>
  </Link>;
}
