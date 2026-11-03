import { NotificationSettings } from "@/features/notifications/components";
import { Palette, WalletCards } from "lucide-react";
import { Suspense } from "react";
import { AccountProfile } from "@/features/auth/components/account-profile";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { InstallControl } from "@/components/pwa/install-control";
export const metadata = { title: "Configuración" };
export default function SettingsPage() {
  return <div className="max-w-3xl space-y-7"><div><h1 className="text-3xl font-semibold tracking-tight">Configuración</h1><p className="mt-2 text-sm text-muted-foreground">Un espacio que se sienta tuyo.</p></div><InstallControl/><Suspense fallback={<p role="status">Cargando tu cuenta…</p>}><AccountProfile /></Suspense><NotificationSettings /><Card><CardHeader><CardTitle className="flex items-center gap-2"><Palette className="size-4 text-primary" aria-hidden="true" />Apariencia</CardTitle><CardDescription>Elegí un tema claro, oscuro o el de tu dispositivo. Se guarda en este navegador.</CardDescription></CardHeader><CardContent><ThemeSwitcher /></CardContent></Card><Card><CardHeader><CardTitle className="flex items-center gap-2"><WalletCards className="size-4 text-primary" aria-hidden="true" />Moneda de los balances</CardTitle><CardDescription>Pesos uruguayos · UYU</CardDescription></CardHeader><CardContent className="text-sm leading-7 text-muted-foreground">Los balances y pagos siempre se expresarán en UYU. Los gastos en otra moneda conservarán su importe original y la conversión manual aplicada al confirmarlos.</CardContent></Card></div>;
}
