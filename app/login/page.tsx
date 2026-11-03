import { AuthScreen } from "@/features/auth/components/auth-screen";
export const metadata = { title: "Iniciar sesión" };
export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return <AuthScreen mode="login" searchParams={searchParams} />;
}
