"use client";

import Link from "next/link";
import { useActionState } from "react";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { changePassword, googleLogin, login, recoverPassword, register } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schemas";

export type AuthMode = "login" | "register" | "recovery" | "password";
const modes = {
  login: { action: login, title: "Qué bueno verte de nuevo", description: "Entrá a tu espacio. Los mejores planes te esperan.", submit: "Iniciar sesión" },
  register: { action: register, title: "Todo empieza con vos", description: "Creá tu cuenta y preparate para compartir, sin vueltas.", submit: "Crear cuenta" },
  recovery: { action: recoverPassword, title: "Volvé a tu cuenta", description: "Te enviaremos un enlace para elegir una nueva contraseña.", submit: "Enviar enlace" },
  password: { action: changePassword, title: "Una nueva contraseña", description: "Elegí una contraseña segura para tu cuenta de Tuki.", submit: "Guardar contraseña" },
};

function Feedback({ state }: { state: AuthState }) {
  return <div aria-live="polite">{state.error && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm leading-6 text-destructive">{state.error}</p>}{state.success && <p role="status" className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm leading-6 text-primary">{state.success}</p>}</div>;
}

export function AuthForm({ mode, next = "/", callbackError = false, callbackDetail }: { mode: AuthMode; next?: string; callbackError?: boolean; callbackDetail?: string }) {
  const config = modes[mode];
  const [state, action, pending] = useActionState<AuthState, FormData>(config.action, {});
  const [googleState, googleAction, googlePending] = useActionState<AuthState, FormData>(googleLogin, {});
  const fields = [
    ...(mode === "register" ? [{ name: "displayName", label: "Tu nombre", type: "text", autoComplete: "name", minLength: 2, maxLength: 80 }] : []),
    ...(mode !== "password" ? [{ name: "email", label: "Email", type: "email", autoComplete: "email", minLength: undefined, maxLength: 254 }] : []),
    ...(mode !== "recovery" ? [{ name: "password", label: mode === "password" ? "Nueva contraseña" : "Contraseña", type: "password", autoComplete: mode === "login" ? "current-password" : "new-password", minLength: mode === "login" ? 1 : 10, maxLength: 128 }] : []),
    ...(["register", "password"].includes(mode) ? [{ name: "confirmPassword", label: "Repetí la contraseña", type: "password", autoComplete: "new-password", minLength: 10, maxLength: 128 }] : []),
  ];

  return <div>
    <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{config.title}</h1>
    <p className="mt-3 text-sm leading-7 text-muted-foreground">{config.description}</p>
    {callbackError && <p role="alert" className="mt-5 rounded-lg border border-destructive/25 p-3 text-sm leading-6 text-destructive">{callbackDetail || "No pudimos completar la confirmación de acceso. El enlace puede haber vencido, haber sido utilizado o haberse abierto en otro navegador. Iniciá sesión o solicitá un nuevo enlace."}</p>}
    <form action={action} className="mt-7 space-y-5">
      <input type="hidden" name="next" value={next} />
      <fieldset disabled={pending || googlePending} className="space-y-4 disabled:opacity-60">
        {fields.map(({ name, label, ...props }) => <div key={name} className="space-y-2">
          <label htmlFor={name} className="block text-sm font-medium">{label}</label>
          <input id={name} name={name} {...props} required aria-invalid={!!state.fields?.[name]?.length} aria-describedby={state.fields?.[name]?.length ? `${name}-error` : name === "password" && mode !== "login" ? "password-hint" : undefined} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring aria-invalid:border-destructive" />
          {name === "password" && mode !== "login" && <p id="password-hint" className="text-xs text-muted-foreground">Entre 10 y 128 caracteres. Evitá reutilizar contraseñas.</p>}
          {state.fields?.[name]?.length && <p id={`${name}-error`} className="text-xs text-destructive">{state.fields[name]?.[0]}</p>}
        </div>)}
      </fieldset>
      {mode === "login" && <Link href="/recuperar-contrasena" className="block text-right text-xs font-medium text-primary hover:underline">¿Olvidaste tu contraseña?</Link>}
      <Feedback state={state} />
      <Button type="submit" className="w-full" disabled={pending || googlePending || !!state.success}>
        {pending ? <><LoaderCircle className="animate-spin" aria-hidden="true" />Un momento…</> : <>{config.submit}<ArrowRight aria-hidden="true" /></>}
      </Button>
    </form>
    {["login", "register"].includes(mode) && <>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground"><span className="flex-1 border-t" />o continuá con<span className="flex-1 border-t" /></div>
      <form action={googleAction} className="space-y-3"><input type="hidden" name="next" value={next} /><Feedback state={googleState} /><Button variant="outline" className="w-full" disabled={pending || googlePending}>{googlePending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <span aria-hidden="true" className="font-semibold">G</span>}Google</Button></form>
    </>}
    <div className="mt-7 text-center text-sm text-muted-foreground">
      {mode === "login" ? <>¿Primera vez por acá? <Link className="font-medium text-primary hover:underline" href={`/registro?next=${encodeURIComponent(next)}`}>Creá tu cuenta</Link></> : mode === "register" ? <>¿Ya tenés cuenta? <Link className="font-medium text-primary hover:underline" href={`/login?next=${encodeURIComponent(next)}`}>Iniciá sesión</Link></> : <Link className="font-medium text-primary hover:underline" href={mode === "password" ? "/configuracion" : "/login"}>{mode === "password" ? "Volver a mi cuenta" : "Volver al inicio de sesión"}</Link>}
    </div>
  </div>;
}
