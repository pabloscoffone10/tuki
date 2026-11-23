import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QuickDebtActions } from "@/features/payments/components/quick-debt-actions";
import { paymentWorkspace } from "@/features/payments/data";
import { debtStates, pairKey } from "@/features/payments/debt-state";
import { formatUyu } from "../domain";
import { FinanceFailure } from "./views";
import { ShareFinance } from "./share-finance";

export async function PersonalBalances() {
  let data;
  try {
    data = await paymentWorkspace();
  } catch (error) {
    return <FinanceFailure error={error} />;
  }

  const me = data.person_id;
  const pending = debtStates(data)
    .filter((row): row is typeof row & { remaining_minor: string } =>
      (row.state === "pending" || row.state === "partial") &&
      (row.payer_id === me || row.receiver_id === me) &&
      row.remaining_minor !== null && BigInt(row.remaining_minor) > 0n
    );
  const { receive, pay } = pending.reduce((totals, row) => {
    totals[row.receiver_id === me ? "receive" : "pay"] += BigInt(row.remaining_minor);
    return totals;
  }, { receive: 0n, pay: 0n });

  return (
    <>
      <section aria-label="Resumen de balances" className="grid grid-cols-2 gap-3">
        <Card className="gap-1 p-4">
          <h2 className="text-sm text-muted-foreground">Te deben</h2>
          <p className="break-words text-lg font-semibold text-success sm:text-xl">{formatUyu(receive)}</p>
        </Card>
        <Card className="gap-1 p-4">
          <h2 className="text-sm text-muted-foreground">Debés</h2>
          <p className="break-words text-lg font-semibold text-destructive sm:text-xl">{formatUyu(pay)}</p>
        </Card>
      </section>
      <section aria-labelledby="deudas-pendientes" className="space-y-3">
        <h2 id="deudas-pendientes" className="text-lg font-semibold">Saldos pendientes</h2>
        {!pending.length && <p className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">No tenés saldos pendientes visibles.</p>}
        {pending.map(row => {
          const key = pairKey(row.payer_id, row.receiver_id);
          const amount = row.remaining_minor;
          const incoming = row.receiver_id === me;
          const obligations = data.obligations.filter(item => pairKey(item.debtor_id, item.creditor_id) === key);
          const origins = [...new Map(obligations.map(item => [item.origin_group_id, { id: item.origin_group_id, name: item.origin_group_name }])).values()];
          const canRecord = data.options.some(option => option.payer_id === row.payer_id && option.receiver_id === row.receiver_id);
          return (
            <article key={key} className="space-y-3 rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="break-words font-semibold">{incoming ? `${row.payer_name} te debe` : `Le debés a ${row.receiver_name}`}</h3>
                <strong className={incoming ? "text-success" : "text-destructive"}>{formatUyu(amount)}</strong>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge>{row.state === "partial" ? "Parcialmente pagado" : "Pendiente"}</Badge>
                {row.pending_payment && <Badge>Pago esperando confirmación</Badge>}
              </div>
              {canRecord && <QuickDebtActions
                payer={row.payer_id} receiver={row.receiver_id}
                payerName={row.payer_name} receiverName={row.receiver_name}
                amount={amount} origins={origins} showReminderCopy={false}
              />}
              <ShareFinance message={`¡Hola! En Tuki quedó un saldo pendiente de ${formatUyu(amount)}.`} path="/balances" />
              <details className="border-t pt-2 text-sm">
                <summary className="min-h-10 cursor-pointer py-2 text-primary">Ver detalle</summary>
                <ul className="space-y-2 text-muted-foreground">
                  {obligations.map(item => <li key={item.id}>{item.origin_group_name} · {item.debtor_name} → {item.creditor_name} · {formatUyu(item.amount_minor)}</li>)}
                </ul>
                <Link className="inline-flex min-h-10 items-center text-primary underline" href="/pagos">Ver historial de pagos</Link>
              </details>
            </article>
          );
        })}
      </section>
    </>
  );
}
