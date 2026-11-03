import { AdministrativeContexts } from "@/features/payments/components/administrative-contexts";
import { Suspense } from "react";
import { randomUUID } from "node:crypto";
import Link from "next/link";
import { z } from "zod";
import { paymentWorkspace } from "@/features/payments/data";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { FinanceFailure } from "@/features/finance/components/views";
export const metadata={title:"Registrar pago"};
async function Content({searchParams}:PageProps<"/pagos/nuevo">){
 const params=await searchParams;const groupId=typeof params.grupo==="string"?params.grupo:undefined,payer=typeof params.paga==="string"?params.paga:undefined,receiver=typeof params.recibe==="string"?params.recibe:undefined;
 if([groupId,payer,receiver].some(id=>id&&!z.uuid().safeParse(id).success))return <p role="alert">Revisá las referencias del pago.</p>;
 let data;try{data=await paymentWorkspace(groupId);}catch(error){return <FinanceFailure error={error}/>;}
 return <div className="mx-auto max-w-3xl space-y-6"><Link className="text-sm text-primary" href={groupId?`/pagos?grupo=${groupId}`:"/pagos"}>← Saldar deudas</Link><h1 className="text-3xl font-semibold">Registrar pago</h1><p className="text-sm leading-7 text-muted-foreground">Tuki registra un pago realizado fuera de la aplicación. La confirmación de la contraparte actualiza el saldo; esta pantalla no realiza transferencias bancarias.</p>{!groupId&&<AdministrativeContexts/>}<PaymentForm id={randomUUID()} workspace={data} groupId={groupId} initialPayer={payer} initialReceiver={receiver}/></div>;
}
export default function Page(props:PageProps<"/pagos/nuevo">){return <Suspense fallback={<p>Cargando obligaciones…</p>}><Content {...props}/></Suspense>;}
