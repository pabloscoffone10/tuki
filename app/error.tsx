"use client";
import { CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div role="alert" className="mx-auto flex min-h-80 max-w-md flex-col items-center justify-center gap-4 text-center"><CircleAlert className="size-9 text-destructive" aria-hidden="true" /><h1 className="text-xl font-semibold">No pudimos cargar esta sección</h1><p className="text-sm leading-7 text-muted-foreground">Ocurrió un problema inesperado. Podés volver a intentar en unos segundos.</p><Button onClick={reset}>Volver a intentar</Button></div>; }
