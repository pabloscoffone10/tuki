import { AuthScreen } from "@/features/auth/components/auth-screen";
export const metadata = { title: "Recuperar contraseña" };
export default function RecoveryPage({ searchParams }: PageProps<"/recuperar-contrasena">) {
  return <AuthScreen mode="recovery" searchParams={searchParams} />;
}
