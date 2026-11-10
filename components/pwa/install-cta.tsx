"use client";

import { useState, useSyncExternalStore } from "react";
import { Download, Share, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { consumeInstallPrompt, useInstallState } from "./install-events";

function installedSnapshot() { return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true; }
function subscribeInstalled(listener: () => void) { const media = window.matchMedia?.("(display-mode: standalone)"); media?.addEventListener?.("change", listener); return () => media?.removeEventListener?.("change", listener); }

export function InstallCta() {
  const { prompt, installed } = useInstallState();
  const standalone = useSyncExternalStore(subscribeInstalled, installedSnapshot, () => false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const isIos = /iphone|ipad|ipod/i.test(typeof navigator === "undefined" ? "" : navigator.userAgent);

  async function install() {
    if (busy) return;
    if (!prompt) { setShowHelp(true); return; }
    setBusy(true); setError(false);
    try { await prompt.prompt(); await prompt.userChoice; } catch { setError(true); } finally { consumeInstallPrompt(); setBusy(false); }
  }

  if (installed || standalone) return <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground"><Smartphone className="size-3.5" /> Tuki ya está instalado</p>;
  return <div className="mt-6 text-center"><Button type="button" variant="outline" size="sm" className="h-10 w-full rounded-xl" onClick={install} disabled={busy}>{busy ? "Abriendo instalación…" : <><Download className="size-4" /> Descargar Tuki</>}</Button>{((!prompt && isIos) || showHelp && isIos) && <p className="mt-3 text-[11px] leading-5 text-muted-foreground"><Share className="mr-1 inline size-3.5 align-[-2px]" />En Safari: tocá Compartir y elegí «Agregar a pantalla de inicio».</p>}{((!prompt && !isIos) || showHelp && !isIos) && <p className="mt-3 text-[11px] leading-5 text-muted-foreground">La instalación aparecerá cuando tu navegador la habilite.</p>}{error && <p role="alert" className="mt-2 text-[11px] text-destructive">No pudimos abrir la instalación. Probá desde el menú del navegador.</p>}</div>;
}
