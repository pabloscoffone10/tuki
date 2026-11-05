import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { PublicFooter } from "@/components/layout/public-footer";
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-dvh flex-col"><header className="flex flex-wrap items-center justify-between gap-4 border-b px-6 py-5"><Brand/><nav aria-label="Navegación pública" className="flex flex-wrap items-center gap-4 text-sm"><Link href="/ayuda">Ayuda</Link><Link href="/feedback">Enviar sugerencia</Link><Link href="/">Mi espacio</Link><ThemeSwitcher/></nav></header><main id="contenido" className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-10">{children}</main><PublicFooter/></div>;
}
