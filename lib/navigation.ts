import { ChartNoAxesCombined, CircleHelp, HandCoins, LayoutDashboard, Settings2, UsersRound, WalletCards } from "lucide-react";

export const navigation = [
  { href: "/", label: "Resumen", icon: LayoutDashboard },
  { href: "/grupos", label: "Mis grupos", icon: UsersRound },
  { href: "/gastos", label: "Gastos", icon: WalletCards },
  { href: "/balances", label: "Balances", icon: WalletCards },
  { href: "/pagos", label: "Pagos", icon: HandCoins },
  { href: "/actividad", label: "Actividad", icon: ChartNoAxesCombined },
] as const;
export const secondaryNavigation = [
  { href: "/personas", label: "Mis invitados", icon: UsersRound },
  { href: "/configuracion", label: "Configuración", icon: Settings2 },
  { href: "/ayuda", label: "Cómo funciona", icon: CircleHelp },
] as const;
export function isActiveRoute(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
