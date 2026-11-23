import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PersonalBalances } from "@/features/finance/components/personal-balances";
import { ExpenseBalanceResult } from "@/features/finance/components/expense-balance-result";
import { ShareFinance } from "@/features/finance/components/share-finance";
import { paymentWorkspace } from "@/features/payments/data";
import { groupFinances } from "@/features/finance/data";
import type { ExpenseDetail } from "@/features/finance/types";
import type { PairState, PaymentWorkspace } from "@/features/payments/types";

vi.mock("@/features/payments/data", () => ({ paymentWorkspace: vi.fn() }));
vi.mock("@/features/finance/data", () => ({ groupFinances: vi.fn() }));
vi.mock("@/features/finance/components/views", () => ({ FinanceFailure: () => <p role="alert">Sin acceso</p> }));
vi.mock("@/features/payments/components/quick-debt-actions", () => ({
  QuickDebtActions: () => <button>Pago parcial</button>,
}));

afterEach(() => vi.unstubAllGlobals());

it("uses the same pending pairs for totals and rows and only offers authorized payments", async () => {
  const row: PairState = {
    payer_id: "guest", receiver_id: "me", payer_name: "Pedro", receiver_name: "Yo",
    remaining_minor: "20000", state: "partial", pending_payment: true, scope: "global",
  };
  const workspace: PaymentWorkspace = {
    person_id: "me", obligations: [], payments: [],
    pair_states: [
      row,
      { ...row, payer_id: "me", receiver_id: "ana", receiver_name: "Ana", remaining_minor: "5000", state: "pending", pending_payment: false },
      { ...row, payer_id: "paid", payer_name: "Saldado", remaining_minor: "0", state: "settled" },
    ],
    options: [{ payer_id: "me", receiver_id: "ana", payer_name: "Yo", receiver_name: "Ana", scope: "global", max_minor: "5000" }],
  };
  vi.mocked(paymentWorkspace).mockResolvedValueOnce(workspace);
  render(await PersonalBalances());
  const totals = within(screen.getByRole("region", { name: "Resumen de balances" }));
  expect(totals.getByText("$ 200,00 UYU")).toBeVisible();
  expect(totals.getByText("$ 50,00 UYU")).toBeVisible();
  expect(screen.getByText("Pedro te debe")).toBeVisible();
  expect(screen.getByText("Pago esperando confirmación")).toBeVisible();
  expect(screen.queryByText("Saldado", { exact: false })).toBeNull();
  expect(screen.getAllByRole("button", { name: "Pago parcial" })).toHaveLength(1);
});

it("shows the empty state and handles denied balance reads", async () => {
  vi.mocked(paymentWorkspace).mockResolvedValueOnce({ person_id: "me", obligations: [], options: [], payments: [] });
  const view = render(await PersonalBalances());
  expect(screen.getByText("No tenés saldos pendientes visibles.")).toBeVisible();
  vi.mocked(paymentWorkspace).mockRejectedValueOnce(new Error("Denied"));
  view.rerender(await PersonalBalances());
  expect(screen.getByRole("alert")).toBeVisible();
});

it("shows compensated expense balances and omits unrelated pairs", async () => {
  const item = {
    id: "a", debtor_id: "ana", creditor_id: "pedro", amount_minor: "20000",
    debtor_name: "Ana", creditor_name: "Pedro", origin_group_id: "group", origin_group_name: "Casa",
  };
  vi.mocked(groupFinances).mockResolvedValueOnce({
    ledger: [],
    obligations: [
      item,
      { ...item, id: "b", debtor_id: "pedro", creditor_id: "ana", debtor_name: "Pedro", creditor_name: "Ana", amount_minor: "15000" },
      { ...item, id: "c", debtor_id: "other", debtor_name: "Otra persona" },
    ],
  });
  const expense = { id: "expense", group_id: "group", payer_id: "pedro", total_minor: "40000",
    shares: [{ personId: "pedro" }, { personId: "ana" }] } as ExpenseDetail;
  render(await ExpenseBalanceResult({ expense }));
  expect(screen.getByText("Ana le debe a Pedro")).toBeVisible();
  expect(screen.getByText("$ 50,00 UYU")).toBeVisible();
  expect(screen.queryByText(/Otra persona/)).toBeNull();
});

it("shares a private route and offers WhatsApp and link-free copy", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const message = "Saldo pendiente de $ 200,00 UYU.";
  render(<ShareFinance message={message} path="/balances" />);
  fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
  const url = new URL(screen.getByRole("link", { name: "WhatsApp" }).getAttribute("href")!);
  expect(url.searchParams.get("text")).toContain(new URL("/balances", window.location.origin).href);
  fireEvent.click(screen.getByRole("button", { name: "Copiar solo texto" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Texto copiado");
  expect(writeText).toHaveBeenCalledWith(message);
});

it("uses native sharing when it is available", async () => {
  const share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { share });
  const message = "Registré un gasto de $ 400,00 UYU en Tuki.";
  render(<ShareFinance message={message} path="/gastos/expense" />);
  fireEvent.click(screen.getByRole("button", { name: "Compartir" }));
  expect(share).toHaveBeenCalledWith({ text: message, url: new URL("/gastos/expense", window.location.origin).href });
  expect(screen.queryByRole("link", { name: "WhatsApp" })).toBeNull();
});
