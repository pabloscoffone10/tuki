import { z } from "zod";

const email = z.string().trim().max(254).pipe(z.email("Ingresá un email válido."));
export const passwordSchema = z.string().min(10, "Usá al menos 10 caracteres.").max(128, "Usá hasta 128 caracteres.");
export const loginSchema = z.object({ email, password: z.string().min(1, "Ingresá tu contraseña.").max(128) });
export const registerSchema = z.object({
  displayName: z.string().trim().min(2, "Ingresá tu nombre (al menos 2 caracteres).").max(80),
  email,
  password: passwordSchema,
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden." });
export const recoverySchema = z.object({ email });
export const changePasswordSchema = z.object({ password: passwordSchema, confirmPassword: z.string() })
  .refine((value) => value.password === value.confirmPassword, { path: ["confirmPassword"], message: "Las contraseñas no coinciden." });

export type AuthState = { error?: string; success?: string; fields?: Record<string, string[] | undefined> };
