import Link from "next/link";
import { HelpSearch } from "@/features/help/search";
export const metadata = { title: "Centro de ayuda" };
export default function HelpPage() { return <><h1 className="text-3xl font-semibold tracking-tight">Centro de ayuda</h1><p className="text-muted-foreground">Encontrá respuestas para usar Tuki.</p><HelpSearch/><Link className="inline-flex min-h-11 items-center text-primary underline" href="/feedback">¿Necesitás ayuda? Enviá una consulta o sugerencia</Link></>; }
