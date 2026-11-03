import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createReportCsv, createReportPdf, csvCell, decimalMinor, exportPayloadSchema, exportQuerySchema, type ExportPayload } from "@/features/reports/export";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user }, rpc: mocks.rpc }) }));
import { GET } from "@/app/(private)/grupos/[groupId]/exportar/route";
const group = "00000000-0000-4000-8000-000000000001", person = "00000000-0000-4000-8000-000000000002", expense = "00000000-0000-4000-8000-000000000003";
function fixture(): ExportPayload {
  return { statistics: { group_id: group, group_name: "Juana", from: null, to: null, currency: "UYU", expense_count: 1, total_minor: "12550", confirmed_minor: "5000", outstanding_minor: "7550", pending_payment_count: 1,
    people: [{ person_id: person, display_name: "María", advanced_minor: "12550", consumed_minor: "12550", settled_paid_minor: "5000", settled_received_minor: "0", balance_minor: "5000" }],
    currencies: [{ currency: "USD", original_minor: "300", total_minor: "12550" }], categories: [{ category: "food", total_minor: "12550", count: 1 }], timeline: [{ date: "2026-11-03", total_minor: "12550", count: 1 }] },
    expenses: [{ id: expense, group_id: group, group_name: "Juana", status: "active", version: 1, title: "Cena; amigos\n\"especial\"", category: "food", expense_date: "2026-11-03", total_minor: "12550", payer_id: person, payer_name: "María", currency: "USD", original_minor: "300", rate: "41.833333", method: "equal", created_at: "2026-11-03T20:00:00Z", participants: [{ person_id: person, display_name: "María", amount_minor: "12550" }] }] };
}
describe("Exact and safe report files", () => {
  it("preserves centésimos above safe integers and validates date filters", () => {
    expect(decimalMinor("99999999999999999999")).toBe("999999999999999999,99");
    expect(decimalMinor("-1")).toBe("-0,01");
    expect(exportQuerySchema.safeParse({ format: "csv", from: "2026-02-30" }).success).toBe(false);
    expect(exportQuerySchema.safeParse({ format: "pdf", from: "2026-11-04", to: "2026-11-03" }).success).toBe(false);
  });
  it("guards formula prefixes including whitespace and control characters", () => {
    for (const attack of ["=HYPERLINK(\"https://example.com\")", " +1+2", "\t@SUM(1)", "\r-1", "\u0001=cmd", "\n123"]) expect(csvCell(attack)).toMatch(/^"'/);
    expect(csvCell('a;"b\nc')).toBe('"a;""b\nc"');
  });
  it("writes Excel UTF-8 BOM, quoted semicolon cells, original currencies and separate liquidation totals", () => {
    const report = fixture(); report.expenses[0].title = "=2+2";
    const csv = createReportCsv(report, new Date("2026-11-04T00:00:00Z"));
    expect(csv.startsWith("\ufeff")).toBe(true); expect(csv).toContain('"\'=2+2"');
    expect(csv).toContain('"125,50"'); expect(csv).toContain('"USD";"3,00";"41,833333"');
    expect(csv).toContain('"Liquidado UYU";"50,00"'); expect(csv).toContain("2026-11-04T00:00:00.000Z");
    expect(csv).not.toContain("receipt"); expect(csv).not.toContain("https:");
    expect(createReportCsv(fixture())).toContain('"Cena; amigos\n""especial"""');
  });
  it("rejects incomplete, cross-group, duplicate or inconsistent exports instead of producing partial totals", () => {
    const missing = fixture(); missing.expenses = []; expect(exportPayloadSchema.safeParse(missing).success).toBe(false);
    const foreign = fixture(); foreign.expenses[0].group_id = person; expect(exportPayloadSchema.safeParse(foreign).success).toBe(false);
    const shares = fixture(); shares.expenses[0].participants[0].amount_minor = "100"; expect(exportPayloadSchema.safeParse(shares).success).toBe(false);
    const duplicate = fixture(); duplicate.expenses.push(duplicate.expenses[0]); duplicate.statistics.expense_count = 2; duplicate.statistics.total_minor = "25100";
    expect(exportPayloadSchema.safeParse(duplicate).success).toBe(false);
  });
  it("generates a real PDF with multiple pages, Spanish text and unsupported characters without leaking attachments", async () => {
    const report = fixture(); report.statistics.group_name = "Viaje 🧉";
    report.statistics.people = Array.from({ length: 45 }, (_, index) => ({ ...report.statistics.people[0], display_name: `María ${index} 🧉` }));
    const bytes = await createReportPdf(report, new Date("2026-11-04T00:00:00Z")), pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1); expect(pdf.getTitle()).toBe("Tuki - Resumen financiero");
    expect(pdf.getCreationDate()?.toISOString()).toBe("2026-11-04T00:00:00.000Z");
  });
  it("renders a valid empty report rather than inventing data", async () => {
    const report = fixture(); report.expenses = []; Object.assign(report.statistics, { people: [], currencies: [], categories: [], timeline: [], expense_count: 0, total_minor: "0", confirmed_minor: "0", outstanding_minor: "0", pending_payment_count: 0 });
    expect(createReportCsv(report)).toContain('"Total de gastos UYU";"0,00"');
    expect((await PDFDocument.load(await createReportPdf(report))).getPageCount()).toBe(1);
  });
});
describe("Private on-demand export route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: person } }, error: null }); mocks.rpc.mockResolvedValue({ data: fixture(), error: null }); });
  const request = (query = "format=csv") => GET(new Request(`http://localhost/grupos/${group}/exportar?${query}`), { params: Promise.resolve({ groupId: group }) });
  it("rejects unauthenticated and unauthorized users without returning sensitive content", async () => {
    mocks.user.mockResolvedValueOnce({ data: { user: null }, error: null }); expect((await request()).status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "group_forbidden private details" } }); const denied = await request();
    expect(denied.status).toBe(403); expect(await denied.text()).not.toContain("private details");
  });
  it("validates forged filters and enforces group authorization through the cookie-authenticated RPC", async () => {
    expect((await request(`format=csv&participant=${person}`)).status).toBe(400);
    expect((await request("format=csv&from=2026-11-04&to=2026-11-03")).status).toBe(400);
    expect((await request("format=csv&format=pdf")).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
    const response = await request("format=csv&from=2026-11-01&to=2026-11-30");
    expect(response.status).toBe(200); expect(mocks.rpc).toHaveBeenCalledWith("tuki_group_export", { p_group_id: group, p_from: "2026-11-01", p_to: "2026-11-30" });
    expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("content-disposition")).toContain("attachment;");
    expect(response.headers.get("content-type")).toContain("text/csv");
  });
  it("reports oversized exports or missing migration, and rejects an unexpected group payload", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "report_export_limit" } }); expect((await request()).status).toBe(413);
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } }); expect((await request()).status).toBe(503);
    const wrong = fixture(); wrong.statistics.group_id = person; wrong.expenses[0].group_id = person;
    mocks.rpc.mockResolvedValueOnce({ data: wrong, error: null }); expect((await request()).status).toBe(502);
  });
  it("returns a PDF as a private attachment generated without persistence", async () => {
    const response = await request("format=pdf"); expect(response.status).toBe(200); expect(response.headers.get("content-type")).toBe("application/pdf");
    expect((await PDFDocument.load(await response.arrayBuffer())).getPageCount()).toBe(1);
  });
  it("handles a failed upstream request without echoing tokens or internal diagnostics",async()=>{
    mocks.rpc.mockRejectedValueOnce(Error("private upstream token diagnostic"));const response=await request();expect(response.status).toBe(503);expect(await response.text()).not.toContain("token");expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
