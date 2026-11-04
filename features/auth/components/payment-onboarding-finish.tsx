"use client";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { finishPaymentOnboarding } from "../onboarding-actions";
export function PaymentOnboardingFinish({next}:{next:string}){
 const [state,action,pending]=useActionState(finishPaymentOnboarding,{});
 return <form action={action} className="space-y-3"><input type="hidden" name="next" value={next}/><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={pending}>Continuar</Button><Button disabled={pending} variant="ghost">Omitir por ahora</Button></div>{state.error&&<p role="alert" className="text-sm text-destructive">{state.error}</p>}<p className="text-xs text-muted-foreground">Podés agregar o cambiar tus cuentas más adelante en Configuración.</p></form>;
}
