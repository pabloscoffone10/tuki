"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ShareFinance({ message, path }: { message: string; path: string }) {
  const [fallback, setFallback] = useState<{ text: string; linked: string }>();
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = new URL(path, window.location.origin).href;
    const linked = `${message} Podés revisar las cuentas en Tuki: ${url}`;
    if (navigator.share) {
      try {
        await navigator.share({ text: message, url });
        return;
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    setCopied(false);
    setFallback({ text: message, linked });
  }

  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant="outline" onClick={() => void share()}>
        Compartir
      </Button>
      {fallback && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="ghost">
              <a target="_blank" rel="noopener noreferrer" href={`https://wa.me/?text=${encodeURIComponent(fallback.linked)}`}>WhatsApp</a>
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={async () => {
              try {
                await navigator.clipboard.writeText(fallback.text);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}>Copiar solo texto</Button>
          </div>
          <p className="select-all text-xs text-muted-foreground">{fallback.text}</p>
          {copied && <p role="status" className="text-xs">Texto copiado.</p>}
        </div>
      )}
    </div>
  );
}
