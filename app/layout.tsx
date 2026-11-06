import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { ThemeProvider } from "@/components/providers/theme-provider";
import type { Viewport } from "next";
import { PwaStatus } from "@/components/pwa/pwa-status";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Tuki · Compartir, sin vueltas.", template: "%s · Tuki" },
  applicationName: "Tuki",
  description: "Tuki · Compartir, sin vueltas. Tu espacio para organizar gastos compartidos entre amigos. Las cuentas claras, los buenos momentos juntos.",
  manifest:"/manifest.webmanifest",
  appleWebApp:{capable:true,title:"Tuki",statusBarStyle:"default"},
  icons: { icon: "/icon.svg",apple:[{url:"/icons/icon-192.png",sizes:"192x192",type:"image/png"}] },
};
export const viewport:Viewport={width:"device-width",initialScale:1,viewportFit:"cover",themeColor:[{media:"(prefers-color-scheme: light)",color:"#5b35e9"},{media:"(prefers-color-scheme: dark)",color:"#151b18"}]};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-UY" suppressHydrationWarning className="h-full antialiased">
      <body className="min-h-full"><ThemeProvider><PwaStatus/>{children}</ThemeProvider><Analytics /></body>
    </html>
  );
}
