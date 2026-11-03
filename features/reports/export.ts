import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";

const money = z.string().regex(/^-?\d+$/).max(40);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(1000);
const date = z.iso.date();
export const exportQuerySchema = z.object({
  format: z.enum(["csv", "pdf"]),
  from: date.optional(), to: date.optional(),
}).refine(v => !v.from || !v.to || v.from <= v.to, { message: "El período no es válido." });
export const exportPayloadSchema = z.object({
  statistics: z.object({
    group_id: z.uuid(), group_name: text, from: date.nullable(), to: date.nullable(), currency: z.literal("UYU"),
    expense_count: count, total_minor: money, confirmed_minor: money, outstanding_minor: money, pending_payment_count: count,
    people: z.array(z.object({ person_id: z.uuid(), display_name: text, advanced_minor: money, consumed_minor: money,
      settled_paid_minor: money, settled_received_minor: money, balance_minor: money })).max(1000),
    currencies: z.array(z.object({ currency: z.string().regex(/^[A-Z]{3}$/), original_minor: money, total_minor: money })).max(20),
    categories: z.array(z.object({ category: text, total_minor: money, count })).max(20),
    timeline: z.array(z.object({ date, total_minor: money, count })).max(1000),
  }),
  expenses: z.array(z.object({
    id: z.uuid(), group_id: z.uuid(), group_name: text, status: z.literal("active"), version: count,
    title: text, category: text, expense_date: date, total_minor: money, payer_id: z.uuid(), payer_name: text,
    currency: z.string().regex(/^[A-Z]{3}$/), original_minor: money, rate: z.string().regex(/^\d+(\.\d+)?$/).max(40),
    method: z.enum(["equal", "percent", "custom", "units"]), created_at: z.string().max(50),
    participants: z.array(z.object({ person_id: z.uuid(), display_name: text, amount_minor: money })).max(1000),
  })).max(1000),
}).superRefine((value, ctx) => {
  const stats = value.statistics;
  if (stats.expense_count !== value.expenses.length || value.expenses.some(row => row.group_id !== stats.group_id)
    || new Set(value.expenses.map(row => row.id)).size !== value.expenses.length
    || value.expenses.reduce((sum, row) => sum + BigInt(row.total_minor), 0n) !== BigInt(stats.total_minor)
    || value.expenses.some(row => row.participants.reduce((sum, person) => sum + BigInt(person.amount_minor), 0n) !== BigInt(row.total_minor))) {
    ctx.addIssue({ code: "custom", message: "El informe recibido es inconsistente o incompleto." });
  }
});
export type ExportPayload = z.infer<typeof exportPayloadSchema>;

/** Exact centésimos. No monetary Number conversions, even beyond JS safe integers. */
export function decimalMinor(value: string) {
  const number = BigInt(value), absolute = number < 0n ? -number : number;
  return `${number < 0n ? "-" : ""}${absolute / 100n},${String(absolute % 100n).padStart(2, "0")}`;
}
export function csvCell(value: string) {
  // Excel may ignore leading whitespace/control characters when evaluating a cell.
  // Protect every text field before RFC-style quoting, including multiline values.
  const guarded = /^[\s\u0000-\u001f\u007f]*[=+@-]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}
const row = (values: string[]) => values.map(csvCell).join(";");
const period = (payload: ExportPayload) => `${payload.statistics.from ?? "Sin límite inicial"} — ${payload.statistics.to ?? "Sin límite final"}`;
const methods: Record<string, string> = { equal: "Igual", percent: "Porcentaje", custom: "Importes", units: "Unidades" };

export function createReportCsv(input: unknown, generatedAt = new Date()) {
  const payload = exportPayloadSchema.parse(input), stats = payload.statistics;
  const rows: string[][] = [
    ["Tuki · Gastos propios del grupo", stats.group_name], ["Período de fecha del gasto", period(payload)],
    ["Generado", generatedAt.toISOString()], ["Alcance", "Gastos activos del grupo de origen. Sin comprobantes privados ni deudas proyectadas."],
    ["Total de gastos UYU", decimalMinor(stats.total_minor)], ["Liquidado UYU", decimalMinor(stats.confirmed_minor)],
    ["Obligaciones pendientes brutas UYU", decimalMinor(stats.outstanding_minor)],
    ["Solicitudes pendientes de confirmación", String(stats.pending_payment_count)], [],
    ["Fecha del gasto", "Descripción", "Grupo", "Pagador", "Total UYU", "Moneda original", "Importe original", "Cotización UYU", "Participantes y consumo UYU", "Reparto", "Estado", "Fecha de registro", "ID"],
    ...payload.expenses.map(expense => [expense.expense_date, expense.title, expense.group_name, expense.payer_name,
      decimalMinor(expense.total_minor), expense.currency, decimalMinor(expense.original_minor), expense.rate.replace(".", ","),
      expense.participants.map(person => `${person.display_name}: ${decimalMinor(person.amount_minor)} UYU`).join(" | "),
      methods[expense.method], "Activo", expense.created_at, expense.id]),
    [], ["Persona", "Adelantó UYU", "Consumió UYU", "Liquidó UYU", "Recibió liquidaciones UYU", "Balance UYU"],
    ...stats.people.map(person => [person.display_name, decimalMinor(person.advanced_minor), decimalMinor(person.consumed_minor),
      decimalMinor(person.settled_paid_minor), decimalMinor(person.settled_received_minor), decimalMinor(person.balance_minor)]),
    [], ["Moneda original", "Subtotal original", "Total convertido UYU"],
    ...stats.currencies.map(currency => [currency.currency, decimalMinor(currency.original_minor), decimalMinor(currency.total_minor)]),
    [], ["Criterio de liquidación", "Asignaciones confirmadas no revertidas sobre obligaciones de los gastos del período; estado al generar. No sumar a gastos."],
    ["Pendiente", "Obligaciones brutas antes de compensar inversas de un mismo par; no es el saldo neto por persona."],
  ];
  return "\ufeff" + rows.map(row).join("\r\n") + "\r\n";
}

/** On-demand, paginated summary using the installed pdf-lib; no external fonts or services. */
export async function createReportPdf(input: unknown, generatedAt = new Date()) {
  const payload = exportPayloadSchema.parse(input), stats = payload.statistics;
  const doc = await PDFDocument.create();
  doc.setTitle("Tuki - Resumen financiero"); doc.setAuthor("Tuki"); doc.setCreationDate(generatedAt);
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage, y = 0, replacements = false;
  function safe(value: string, selected: PDFFont) {
    return Array.from(value.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, " ")).map(char => {
      try { selected.encodeText(char); return char; } catch { replacements = true; return "?"; }
    }).join("");
  }
  function newPage() {
    page = doc.addPage([595.28, 841.89]); y = 779;
    page.drawText("tuki.  Compartir, sin vueltas.", { x: 42, y, font: bold, size: 17, color: rgb(0.04, 0.23, 0.16) });
    page.drawText(`Resumen financiero | Página ${doc.getPageCount()}`, { x: 42, y: 36, font, size: 9 });
    y -= 34;
  }
  function line(value: string, heading = false) {
    const selected = heading ? bold : font, size = heading ? 12 : 10;
    const clean = safe(value, selected), words = clean.split(/\s+/); let current = "";
    const draw = () => { if (y < 65) newPage(); page.drawText(current, { x: 42, y, font: selected, size }); y -= 16; current = ""; };
    for (const word of words) {
      if (current && selected.widthOfTextAtSize(`${current} ${word}`, size) > 510) draw();
      for (const char of word) {
        if (selected.widthOfTextAtSize(current + char, size) > 510) draw();
        current += char;
      }
      current += " ";
    }
    draw(); if (heading) y -= 6;
  }
  newPage();
  line(stats.group_name, true); line(`Período (fecha del gasto): ${period(payload)}`);
  line(`Generado: ${generatedAt.toISOString()}`);
  line("Solo gastos activos originados en este grupo. No incluye comprobantes privados ni deudas proyectadas.");
  line(`Total de gastos: ${decimalMinor(stats.total_minor)} UYU | Cantidad: ${stats.expense_count}`, true);
  line(`Dinero liquidado: ${decimalMinor(stats.confirmed_minor)} UYU`);
  line(`Obligaciones pendientes brutas: ${decimalMinor(stats.outstanding_minor)} UYU`);
  line(`Solicitudes pendientes de confirmación: ${stats.pending_payment_count}`);
  line("Liquidaciones: asignaciones confirmadas no revertidas sobre los gastos del período, al generar. No son gastos nuevos.");
  line("Pendiente bruto: antes de compensar deudas inversas del mismo par. No equivale al saldo neto individual.");
  line("Adelantos, consumo y liquidaciones por persona", true);
  if (!stats.people.length) line("No hay gastos activos en el período seleccionado.");
  for (const person of stats.people) {
    line(person.display_name, true);
    line(`Adelantó: ${decimalMinor(person.advanced_minor)} UYU | Consumió: ${decimalMinor(person.consumed_minor)} UYU`);
    line(`Liquidó: ${decimalMinor(person.settled_paid_minor)} UYU | Recibió: ${decimalMinor(person.settled_received_minor)} UYU | Balance: ${decimalMinor(person.balance_minor)} UYU`);
  }
  line("Monedas y conversión", true);
  for (const currency of stats.currencies) line(`${currency.currency}: ${decimalMinor(currency.original_minor)} | Convertido: ${decimalMinor(currency.total_minor)} UYU`);
  line("Cada gasto usa la cotización manual guardada en su versión vigente. Las tasas individuales están en el CSV.");
  if (replacements) line("Algunos caracteres no disponibles en la fuente del PDF se muestran como ?. El CSV conserva los nombres completos.");
  return doc.save();
}
