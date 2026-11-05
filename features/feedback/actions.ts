"use server";
import { createHmac } from "node:crypto";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { feedbackSchema } from "./schema";
import { feedbackClient, deliverFeedback } from "./server";
export async function submitFeedback(_previous: { ok: boolean; message: string }, form: FormData) {
  const parsed = feedbackSchema.safeParse(Object.fromEntries(["category", "description", "email", "website"].map(key => [key, form.get(key)])));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  try {
    const auth = await createClient(); const { data, error: authError } = await auth.auth.getUser();
    if (authError && authError.name !== "AuthSessionMissingError") return { ok: false, message: "No pudimos verificar la sesión. Intentá nuevamente." };
    const requestHeaders = await headers();
    // Vercel overwrites this header. Other hosts share an anonymous quota unless a user is verified.
    const identity = data.user?.id ?? (process.env.VERCEL === "1" ? requestHeaders.get("x-vercel-forwarded-for")?.split(",")[0] : null) ?? "anonymous";
    const db = feedbackClient();
    const bucket = createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY!).update(identity).digest("hex");
    const { data: id, error } = await db.rpc("tuki_submit_feedback", { p_user: data.user?.id ?? null, p_category: parsed.data.category, p_description: parsed.data.description, p_email: parsed.data.email, p_bucket: bucket });
    if (error) return { ok: false, message: error.message.includes("feedback_rate_limit") ? "Se alcanzó el límite de envíos. Probá dentro de una hora." : "No pudimos guardar el reporte. Intentá nuevamente." };
    try { await deliverFeedback(id); } catch { console.error("feedback_delivery_pending"); }
    return { ok: true, message: "Recibimos tu reporte. Gracias por ayudarnos a mejorar Tuki. No podemos garantizar una respuesta inmediata." };
  } catch (error) {
    if (error instanceof Error && error.message === "feedback_not_configured") {
      console.error("feedback_not_configured");
      return { ok: false, message: "El formulario de sugerencias todavía no está disponible. Falta completar su configuración en el servidor." };
    }
    console.error("feedback_submit_failed");
    return { ok: false, message: "No pudimos guardar el reporte. Intentá nuevamente más tarde." };
  }
}
