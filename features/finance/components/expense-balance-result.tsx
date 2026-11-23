import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { groupFinances } from "../data";
import { formatUyu, netPairs } from "../domain";
import type { ExpenseDetail } from "../types";
import { ShareFinance } from "./share-finance";

export async function ExpenseBalanceResult({ expense }: { expense: ExpenseDetail }) {
  const groupPath = `/grupos/${expense.group_id}`;
  const participants = new Set(expense.shares.map(share => share.personId));
  const { payer_id: payer } = expense;
  let balances;
  try {
    const summary = await groupFinances(expense.group_id);
    balances = netPairs(summary.obligations).filter(pair =>
      (pair.debtor === payer && participants.has(pair.creditor)) ||
      (pair.creditor === payer && participants.has(pair.debtor))
    );
  } catch {
    // A successful save must still show the persisted expense if this read fails.
  }

  return (
    <Card>
      <CardHeader><CardTitle>Saldos después del gasto</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted-foreground">Saldo vigente entre quien pagó y cada participante, con las compensaciones y los pagos confirmados visibles desde este grupo.</p>
        {balances ? (
          balances.length ? (
            <ul className="space-y-2">
              {balances.map(pair => (
                <li key={`${pair.debtor}:${pair.creditor}`} className="flex flex-wrap justify-between gap-2">
                  <span>{pair.debtorName} le debe a {pair.creditorName}</span>
                  <strong>{formatUyu(pair.amount)}</strong>
                </li>
              ))}
            </ul>
          ) : <p>No quedó saldo pendiente visible entre quien pagó y los participantes.</p>
        ) : <p role="status">No pudimos consultar los saldos actualizados.</p>}
        <Link className="inline-flex min-h-10 items-center text-primary underline" href={groupPath}>Ver detalle del grupo</Link>
        <ShareFinance
          message={`¡Hola! Registré un gasto de ${formatUyu(expense.total_minor)} en Tuki, repartido entre ${participants.size} ${participants.size === 1 ? "persona" : "personas"}.`}
          path={`/gastos/${expense.id}`}
        />
      </CardContent>
    </Card>
  );
}
