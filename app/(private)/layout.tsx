import { Suspense, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import { requireUser } from "@/features/auth/session";
import Loading from "@/app/loading";

async function PrivateLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <AppShell account={<SignOutButton />}>{children}</AppShell>;
}

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}><PrivateLayout>{children}</PrivateLayout></Suspense>;
}
