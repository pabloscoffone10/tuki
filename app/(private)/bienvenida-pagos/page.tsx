import { redirect } from "next/navigation";
import { BankAccounts } from "@/features/bank-accounts/components";
import { PaymentOnboardingFinish } from "@/features/auth/components/payment-onboarding-finish";
import { requireUser } from "@/features/auth/session";
import { safeNext } from "@/features/auth/redirects";
import { createReadOnlyClient } from "@/lib/supabase/server";
export const metadata={title:"Recibí pagos"};
export default async function PaymentWelcomePage({searchParams}:{searchParams:Promise<{next?:string}>}){
 const next=safeNext((await searchParams).next),user=await requireUser();
 const client=await createReadOnlyClient();
 const {data,error}=await client.from("profiles").select("payment_onboarding_state").eq("user_id",user.id).maybeSingle();
 if(error||!data||data.payment_onboarding_state==="done"||!user.email_confirmed_at)redirect(next);
 return <div className="mx-auto max-w-2xl space-y-6"><header className="space-y-2"><p className="text-xs font-medium text-primary">Bienvenido a Tuki</p><h1 className="text-3xl font-semibold tracking-tight">Prepará tu cuenta para recibir pagos</h1><p className="text-sm leading-6 text-muted-foreground">Agregá los datos que tus amigos necesitan para transferirte. Este paso es opcional: podés empezar a compartir gastos ahora.</p></header><BankAccounts/><PaymentOnboardingFinish next={next}/></div>;
}
