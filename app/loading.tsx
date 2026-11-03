import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() { return <div role="status" className="space-y-6"><span className="sr-only">Cargando Tuki…</span><Skeleton className="h-10 w-52" /><Skeleton className="h-52 w-full" /><div className="grid gap-4 sm:grid-cols-3"><Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" /></div></div>; }
