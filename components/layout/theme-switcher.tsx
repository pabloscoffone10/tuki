"use client";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(subscribe, () => true, () => false);
  return <div className="flex items-center gap-0.5 rounded-lg border bg-background p-0.5" role="group" aria-label="Apariencia">
    {[{ value: "light", label: "Tema claro", icon: Sun }, { value: "dark", label: "Tema oscuro", icon: Moon }, { value: "system", label: "Tema del sistema", icon: Monitor }].map(({ value, label, icon: Icon }) =>
      <button key={value} type="button" onClick={() => setTheme(value)} aria-pressed={mounted && theme === value} aria-label={label} title={label} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent aria-pressed:bg-accent aria-pressed:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><Icon className="size-3.5" aria-hidden="true" /></button>,
    )}
  </div>;
}
