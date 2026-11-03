import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function NotFound() { return <div className="flex min-h-80 flex-col items-center justify-center gap-4 text-center"><p className="text-xs font-semibold tracking-widest text-primary">404</p><h1 className="text-2xl font-semibold tracking-tight">Esta página no está en Tuki</h1><p className="text-sm text-muted-foreground">La página que buscás no está disponible.</p><Button asChild><Link href="/">Volver al resumen</Link></Button></div>; }
