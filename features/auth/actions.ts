"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site-url";
import { authFailure } from "./errors";
import { safeNext } from "./redirects";
import { changePasswordSchema, loginSchema, recoverySchema, registerSchema, type AuthState } from "./schemas";


export async function login(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = loginSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los campos indicados.", fields: parsed.error.flatten().fieldErrors };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) return authFailure('login', error);
  } catch (error) { return authFailure('login', error); }
  revalidatePath("/", "layout");
  redirect(safeNext(form.get("next")));
}

export async function register(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = registerSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá los campos indicados.", fields: parsed.error.flatten().fieldErrors };
  try {
    const supabase = await createClient();
    const { displayName, email, password } = parsed.data;
    const { data, error } = await supabase.auth.signUp({ email, password, options: {
      data: { display_name: displayName }, emailRedirectTo: `${getSiteUrl()}/auth/callback`,
    } });
    if (error) return authFailure('register', error);
    // Require email confirmation in Supabase. Do not leave an automatic session
    // behind if confirmation was accidentally disabled in the project settings.
    if (data.session) {
      const { error: signOutError } = await supabase.auth.signOut({ scope: "local" });
      if (signOutError) return authFailure("register", signOutError);
    }
    return { success: "Si el registro está habilitado para este email, recibirás un enlace para confirmar tu cuenta. Revisá tu correo y spam." };
  } catch (error) { return authFailure('register', error); }
}

export async function recoverPassword(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = recoverySchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Ingresá un email válido.", fields: parsed.error.flatten().fieldErrors };
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${getSiteUrl()}/auth/callback?next=/actualizar-contrasena`,
    });
    if (error) return authFailure('recovery', error);
    return { success: "Si existe una cuenta con ese email, recibirás un enlace para cambiar la contraseña. Abrilo en este mismo navegador." };
  } catch (error) { return authFailure('recovery', error); }
}

export async function changePassword(_state: AuthState, form: FormData): Promise<AuthState> {
  const parsed = changePasswordSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: "Revisá la nueva contraseña.", fields: parsed.error.flatten().fieldErrors };
  try {
    const supabase = await createClient();
    const { data, error: sessionError } = await supabase.auth.getUser();
    if (sessionError || !data.user) return { error: "Tu sesión venció. Pedí otro enlace de recuperación o volvé a iniciar sesión." };
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
    if (error) return authFailure('password', error);
    return { success: "Contraseña actualizada. Ya podés usarla para iniciar sesión." };
  } catch (error) { return authFailure('password', error); }
}

export async function googleLogin(_state: AuthState, form: FormData): Promise<AuthState> {
  let destination: string;
  try {
    const supabase = await createClient();
    const callback = new URL("/auth/callback", getSiteUrl());
    callback.searchParams.set("next", safeNext(form.get("next")));
    const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: {
      redirectTo: callback.toString(), skipBrowserRedirect: true,
    } });
    if (error) return authFailure("google", error);
    if (!data.url) return authFailure("google", { code: "provider_disabled" });
    destination = data.url;
  } catch (error) { return authFailure('google', error); }
  redirect(destination);
}

export async function logout(): Promise<AuthState> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) return authFailure("logout", error);
  } catch (error) { return authFailure('logout', error); }
  revalidatePath("/", "layout");
  redirect("/login");
}
