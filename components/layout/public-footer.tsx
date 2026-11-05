import Link from "next/link";
export function PublicFooter() {
  return <footer className="flex flex-wrap items-center justify-center gap-5 p-6 text-xs text-muted-foreground"><span>Tuki · Compartir, sin vueltas.</span><Link className="py-3 hover:underline" href="/ayuda">Ayuda</Link><Link className="py-3 hover:underline" href="/feedback">Enviar sugerencia</Link></footer>;
}
