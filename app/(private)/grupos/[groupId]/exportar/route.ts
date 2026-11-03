import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createReportCsv, createReportPdf, exportPayloadSchema, exportQuerySchema } from "@/features/reports/export";

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Referrer-Policy": "no-referrer",
};
export async function GET(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params, query = new URL(request.url).searchParams;
  const fail = (message: string, status: number) => new Response(message, { status, headers: privateHeaders });
  if (!z.uuid().safeParse(groupId).success) return fail("Informe no disponible.", 404);
  if (["format", "from", "to"].some(key => query.getAll(key).length > 1)
    || Array.from(query.keys()).some(key => !["format", "from", "to"].includes(key))) return fail("Filtros de exportación inválidos.", 400);
  const parsed = exportQuerySchema.safeParse({ format: query.get("format") ?? "csv", from: query.get("from") || undefined, to: query.get("to") || undefined });
  if (!parsed.success) return fail("Seleccioná un formato y un período válidos.", 400);
  try {
  const client = await createClient(), { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return fail("Iniciá sesión para descargar el informe.", 401);
  const { data, error } = await client.rpc("tuki_group_export", { p_group_id: groupId, p_from: parsed.data.from ?? null, p_to: parsed.data.to ?? null });
  if (error) {
    if (error.message?.includes("report_export_limit")) return fail("El informe supera el límite de 1000 gastos. Elegí un período más corto.", 413);
    if (["PGRST202", "42883"].includes(error.code)) return fail("Los informes requieren aplicar la migración 013.", 503);
    return fail("Informe no disponible para esta cuenta y período.", 403);
  }
  const report = exportPayloadSchema.safeParse(data);
  if (!report.success || report.data.statistics.group_id !== groupId) return fail("No pudimos validar el informe completo. Volvé a intentar.", 502);
  try {
    const format = parsed.data.format;
    const body = format === "csv" ? createReportCsv(report.data) : new Uint8Array(await createReportPdf(report.data));
    return new Response(body, { headers: { ...privateHeaders,
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
      "Content-Disposition": `attachment; filename="tuki-${groupId}.${format}"`,
    } });
  } catch {
    return fail("No pudimos generar el archivo. Probá con un período más corto.", 500);
  }
  } catch {
    return fail("No pudimos consultar el informe. Volvé a intentar.", 503);
  }
}
