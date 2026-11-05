import "server-only";
import { createClient } from "@supabase/supabase-js";
export function feedbackClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("feedback_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
export async function deliverFeedback(id?: string) {
  const db = feedbackClient();
  const { data, error } = await db.rpc("tuki_claim_feedback", { p_id: id ?? null });
  if (error) throw new Error("feedback_claim_failed");
  for (const report of data ?? []) {
    let failure: string | null = null;
    try {
      const key = process.env.RESEND_API_KEY, from = process.env.TUKI_FEEDBACK_FROM, to = process.env.TUKI_FEEDBACK_TO;
      if (!key || !from || !to) throw new Error("email_not_configured");
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST", signal: AbortSignal.timeout(10000),
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `feedback/${report.id}` },
        body: JSON.stringify({ from, to: [to], subject: `Tuki: ${report.category}`, text: `Reporte: ${report.id}\nCategoría: ${report.category}\nUsuario: ${report.user_id ?? "Anónimo"}\nCorreo: ${report.email ?? "No indicado"}\n\n${report.description}` }),
      });
      if (!response.ok) failure = `email_http_${response.status}`;
    } catch (error) { failure = error instanceof Error && error.message === "email_not_configured" ? error.message : "email_network_failed"; }
    const result = await db.rpc("tuki_finish_feedback", { p_id: report.id, p_lease: report.lease, p_error: failure });
    if (result.error) console.error("feedback_delivery_status_failed");
  }
}
