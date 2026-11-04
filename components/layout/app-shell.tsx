"use client";
import { NotificationBell,NotificationsProvider } from "@/features/notifications/components";
import type { ReactNode } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, ChevronRight, Menu, PanelLeftClose, Sprout } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brand } from "@/components/layout/brand";
import { useConnectivity } from "@/components/pwa/connectivity";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { isActiveRoute, navigation, secondaryNavigation } from "@/lib/navigation";
import { cn } from "@/lib/utils";

function NavLinks({ secondary = false, onNavigate }: { secondary?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav aria-label={secondary ? "Navegación secundaria" : "Navegación principal"} className="space-y-1">
    {(secondary ? secondaryNavigation : navigation).map(({ href, label, icon: Icon }) => {
      const active = isActiveRoute(pathname, href);
      return <Link key={href} href={href} prefetch={false} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring", active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground")}><Icon className="size-[17px]" aria-hidden="true" />{label}{active && <span className="ml-auto size-1.5 rounded-full bg-primary" />}</Link>;
    })}
  </nav>;
}
function SidebarContents({ onNavigate }: { onNavigate?: () => void }) {
  return <>
    <div className="px-3 pt-8 pb-9"><Brand /></div>
    <div className="mb-6 flex items-center gap-3 rounded-lg border bg-card p-3"><span className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary"><Sprout className="size-4" aria-hidden="true" /></span><div><p className="text-xs font-semibold">Tu espacio personal</p><p className="mt-0.5 text-[11px] text-muted-foreground">Compartir, sin vueltas.</p></div></div>
    <p className="px-3 pb-3 text-[10px] font-semibold tracking-[0.16em] text-muted-foreground">MI ESPACIO</p><NavLinks onNavigate={onNavigate} />
    <div className="mt-auto pt-10"><div className="mb-6 rounded-xl border border-primary/15 bg-primary/5 p-4"><p className="text-xs font-semibold">Las cuentas claras.</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Más tiempo para compartir.</p><Link href="/ayuda" onClick={onNavigate} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">Conocé Tuki<ArrowUpRight className="size-3" aria-hidden="true" /></Link></div><NavLinks secondary onNavigate={onNavigate} /><div className="mt-5 flex items-center justify-between border-t px-2 pt-5 pb-6"><span className="text-[10px] tracking-wide text-muted-foreground">HECHO PARA COMPARTIR</span><span className="text-xs text-primary">✳</span></div></div>
  </>;
}
export function AppShell({ children, account }: { children: ReactNode; account?: ReactNode }) {
  const online=useConnectivity();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const current = [...navigation, ...secondaryNavigation].find(({ href }) => isActiveRoute(pathname, href));
  return <NotificationsProvider><div className="min-h-dvh"><a href="#contenido" className="sr-only fixed top-3 left-3 z-[100] rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only">Saltar al contenido</a>
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col overflow-y-auto border-r bg-sidebar px-4 lg:flex"><SidebarContents /></aside>
    <div className="lg:pl-60"><header className="sticky top-0 z-20 flex h-[72px] items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur-md sm:px-8 lg:px-10"><div className="flex items-center gap-3">
      <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button variant="ghost" size="icon" className="lg:hidden" aria-label="Abrir menú"><Menu /></Button></DialogTrigger><DialogContent className="inset-y-0 left-0 flex h-dvh w-[min(85vw,300px)] max-w-none translate-x-0 translate-y-0 flex-col overflow-y-auto rounded-none border-y-0 border-l-0 bg-sidebar px-4 py-0"><DialogTitle className="sr-only">Menú de navegación</DialogTitle><DialogDescription className="sr-only">Navegá por las secciones de Tuki.</DialogDescription><SidebarContents onNavigate={() => setOpen(false)} /></DialogContent></Dialog>
      {online&&<Brand className="lg:hidden [&_svg]:h-7"/>}<PanelLeftClose className="hidden size-4 text-muted-foreground lg:block" aria-hidden="true" /><span className="hidden h-4 border-l lg:block" /><span className="hidden text-xs text-muted-foreground lg:inline">Mi espacio</span><ChevronRight className="hidden size-3 text-muted-foreground lg:block" aria-hidden="true" /><span className="hidden text-xs font-medium lg:inline">{current?.label ?? "Tuki"}</span>
    </div><div className="flex items-center gap-1 sm:gap-3">{online?<Badge className="hidden border-primary/20 bg-primary/5 text-primary sm:inline-flex"><span className="size-1.5 rounded-full bg-primary" />Tu cuenta</Badge>:<span role="status" className="text-xs font-semibold text-destructive">Sin conexión</span>}<NotificationBell /><ThemeSwitcher />{account}</div></header>
      <main id="contenido" tabIndex={-1} className="mx-auto max-w-[1440px] px-4 py-7 pb-24 outline-none lg:pb-10 sm:px-8 sm:py-10 sm:pb-24 lg:pb-10 lg:px-10">{children}</main>
      <footer className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-6 pb-24 text-[11px] lg:pb-6 text-muted-foreground sm:px-8 sm:pb-24 lg:pb-6 lg:px-10"><span>Tuki · Compartir, sin vueltas.</span><span>Pesos uruguayos <span className="ml-1 rounded border px-1.5 py-0.5 font-medium">UYU</span></span></footer>
    </div>
    <nav aria-label="Accesos rápidos móviles" className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t bg-background/95 px-2 pt-1 backdrop-blur-md lg:hidden" style={{paddingBottom:"env(safe-area-inset-bottom)"}}>{navigation.filter(item=>["/","/grupos","/pagos"].includes(item.href)).map(({href,icon:Icon})=><Link key={href} prefetch={false} href={href} aria-current={isActiveRoute(pathname,href)?"page":undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring",isActiveRoute(pathname,href)?"bg-primary/10 font-semibold text-primary":"text-muted-foreground")}><Icon className="size-5" aria-hidden="true"/>{href==="/"?"Inicio":href==="/grupos"?"Grupos":"Pagos"}</Link>)}</nav>
  </div></NotificationsProvider>;
}
