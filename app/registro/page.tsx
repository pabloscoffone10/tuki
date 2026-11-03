import { AuthScreen } from "@/features/auth/components/auth-screen";
export const metadata = { title: "Crear cuenta" };
export default function RegisterPage({ searchParams }: PageProps<"/registro">) {
  return <AuthScreen mode="register" searchParams={searchParams} />;
}
