import { Suspense } from "react";
import { z } from "zod";
import { PaymentsWorkspace } from "@/features/payments/components/workspace";
export const metadata={title:"Saldar deudas y pagos"};
async function Content({searchParams}:PageProps<"/pagos">){const params=await searchParams;const group=typeof params.grupo==="string"?params.grupo:undefined;if(group&&!z.uuid().safeParse(group).success)return <p role="alert">El grupo indicado no es válido.</p>;return <PaymentsWorkspace groupId={group}/>;}
export default function Page(props:PageProps<"/pagos">){return <Suspense fallback={<p>Cargando pagos…</p>}><Content {...props}/></Suspense>;}
