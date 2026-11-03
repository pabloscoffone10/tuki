"use client";

import { useActionState } from "react";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/actions";
import type { AuthState } from "@/features/auth/schemas";
import { isOnline,useConnectivity } from "@/components/pwa/connectivity";

export function SignOutButton() {
  const online=useConnectivity();
  const [state, action, pending] = useActionState<AuthState, FormData>(logout, {});
  return <form action={action} className="relative" onSubmitCapture={event=>{if(!isOnline())event.preventDefault();}}>
    <Button type="submit" size="icon" variant="ghost" disabled={pending||!online} aria-label={pending ? "Cerrando sesión" : "Cerrar sesión"} title={online?"Cerrar sesión":"Conectate para cerrar la sesión del servidor"}><LogOut aria-hidden="true" /></Button>
    {state.error && <p role="alert" className="absolute top-full right-0 mt-2 w-64 rounded-lg border bg-card p-3 text-xs text-destructive shadow-sm">{state.error}</p>}
  </form>;
}
