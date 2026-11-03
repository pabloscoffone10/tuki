import { Suspense } from "react";
import { AuthForm } from "@/features/auth/components/auth-form";
import { requireUser } from "@/features/auth/session";
export const metadata = { title: "Cambiar contraseña" };
async function PasswordForm() {
  await requireUser();
  return <AuthForm mode="password" />;
}
export default function ChangePasswordPage() {
  return <div className="mx-auto max-w-md rounded-xl border bg-card p-6 sm:p-8"><Suspense fallback={<p role="status">Verificando tu sesión…</p>}><PasswordForm /></Suspense></div>;
}
