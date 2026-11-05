import { PublicFooter } from "@/components/layout/public-footer";
import { Suspense } from "react";
import { Brand } from "@/components/layout/brand";
import { ThemeSwitcher } from "@/components/layout/theme-switcher";
import { AuthForm, type AuthMode } from "./auth-form";
import { safeNext } from "@/features/auth/redirects";
import { callbackDiagnostic, callbackReason } from "@/features/auth/errors";

type Query = Promise<Record<string, string | string[] | undefined>>;
async function FormWithQuery({ mode, searchParams }: { mode: AuthMode; searchParams: Query }) {
  const query = await searchParams;
  return <AuthForm mode={mode} next={safeNext(query.next)} callbackError={query.error === "callback"} callbackDetail={callbackReason(query.reason) || callbackDiagnostic(query.diagnostic)} />;
}

export function AuthScreen({ mode, searchParams }: { mode: AuthMode; searchParams: Query }) {
  return <div className="flex min-h-dvh flex-col bg-background">
    <header className="flex items-center justify-between px-6 py-6 sm:px-10"><Brand /><ThemeSwitcher /></header>
    <main id="contenido" className="flex flex-1 items-center justify-center px-4 py-10"><div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-9">
      <Suspense fallback={<p role="status" className="py-12 text-center text-sm text-muted-foreground">Preparando tu acceso…</p>}><FormWithQuery mode={mode} searchParams={searchParams} /></Suspense>
    </div></main>
    <PublicFooter/>
  </div>;
}
