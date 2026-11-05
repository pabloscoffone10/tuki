import { timingSafeEqual } from "node:crypto";
import { deliverFeedback } from "@/features/feedback/server";
export async function POST(request: Request) {
  const secret = process.env.TUKI_FEEDBACK_CRON_SECRET, provided = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!secret || secret.length < 32 || !provided || Buffer.byteLength(secret) !== Buffer.byteLength(provided) || !timingSafeEqual(Buffer.from(secret), Buffer.from(provided))) return Response.json({ error: "unauthorized" }, { status: 401 });
  try { await deliverFeedback(); return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "retry_failed" }, { status: 503 }); }
}
