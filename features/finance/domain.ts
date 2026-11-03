export const currencies = ["UYU", "USD", "ARS", "BRL", "EUR", "GBP", "CHF", "CAD", "AUD"] as const;
export type SplitMethod = "equal" | "percent" | "custom" | "units";
export type Allocation = { personId: string; input: string };
export function unitsDecimal(value: string, scale = 2) {
  const n = BigInt(value); const base = 10n ** BigInt(scale);
  return `${n / base}.${(n % base).toString().padStart(scale, "0")}`;
}
export function decimalUnits(value: string, scale: number): bigint {
  if (!new RegExp(`^[0-9]{1,14}(?:\\.[0-9]{1,${scale}})?$`).test(value)) throw new Error("Usá un decimal positivo con punto y la precisión indicada.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0"));
}
export function convertToUyu(amount: string, currency: string, rate: string) {
  if (!(currencies as readonly string[]).includes(currency)) throw new Error("Moneda no compatible.");
  const original = decimalUnits(amount, 2);
  const fx = currency === "UYU" ? 1_000_000n : decimalUnits(rate, 6);
  const total = (original * fx + 500_000n) / 1_000_000n;
  if (original <= 0n || original > 1_000_000_000_000n || fx <= 0n || fx > 1_000_000_000_000n || total <= 0n || total > 100_000_000_000_000n) throw new Error("El importe o la cotización están fuera de rango.");
  return { original, rate: fx, total };
}
export function allocate(total: bigint, method: SplitMethod, people: Allocation[]) {
  if (total <= 0n || !people.length || people.length > 100 || new Set(people.map((p) => p.personId)).size !== people.length) throw new Error("Seleccioná participantes distintos.");
  if (!["equal", "percent", "custom", "units"].includes(method)) throw new Error("Reparto inválido.");
  const weights = people.map((person) => ({ ...person, weight: method === "equal" ? 1n : decimalUnits(person.input, method === "custom" ? 2 : 4) }));
  const sum = weights.reduce((n, p) => n + p.weight, 0n);
  if (sum <= 0n || (method === "percent" && sum !== 1_000_000n) || (method === "custom" && sum !== total) || (method === "units" && weights.some((p) => p.weight <= 0n))) throw new Error("El reparto no coincide con el total o el 100%; las cantidades deben ser positivas.");
  const rows = weights.map((p) => ({ personId: p.personId, amount: method === "custom" ? p.weight : total * p.weight / sum, remainder: total * p.weight % sum }));
  let left = total - rows.reduce((n, p) => n + p.amount, 0n);
  const ranked = [...rows].sort((a, b) => a.remainder === b.remainder ? (a.personId < b.personId ? -1 : 1) : a.remainder > b.remainder ? -1 : 1);
  for (const row of ranked) if (left > 0n) { row.amount++; left--; }
  return rows.map(({ personId, amount }) => ({ personId, amount }));
}
export type Obligation = { id: string; debtor_id: string; creditor_id: string; amount_minor: string; origin_group_id: string; origin_group_name: string; debtor_name: string; creditor_name: string; original_amount_minor?:string;paid_minor?:string };
export function netPairs(obligations: Obligation[]) {
  const seen = new Set<string>();
  const pairs = new Map<string, { first: string; second: string; firstName: string; secondName: string; signed: bigint }>();
  for (const row of obligations) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const forward = row.debtor_id < row.creditor_id;
    const first = forward ? row.debtor_id : row.creditor_id;
    const second = forward ? row.creditor_id : row.debtor_id;
    const key = `${first}:${second}`;
    const pair = pairs.get(key) || { first, second, firstName: forward ? row.debtor_name : row.creditor_name, secondName: forward ? row.creditor_name : row.debtor_name, signed: 0n };
    pair.signed += BigInt(row.amount_minor) * (forward ? 1n : -1n);
    pairs.set(key, pair);
  }
  return [...pairs.values()].filter((p) => p.signed !== 0n).map((p) => ({ debtor: p.signed > 0n ? p.first : p.second, creditor: p.signed > 0n ? p.second : p.first, debtorName: p.signed > 0n ? p.firstName : p.secondName, creditorName: p.signed > 0n ? p.secondName : p.firstName, amount: p.signed > 0n ? p.signed : -p.signed }));
}
export function formatMoney(minor: bigint | string, currency = "UYU") {
  const n = BigInt(minor); const positive = n < 0n ? -n : n;
  return `${n < 0n ? "−" : ""}${currency === "UYU" ? "$ " : ""}${new Intl.NumberFormat("es-UY").format(positive / 100n)},${(positive % 100n).toString().padStart(2, "0")} ${currency}`;
}
export const formatUyu = (minor: bigint | string) => formatMoney(minor);
export const categoryNames: Record<string, string> = { food: "Comida", travel: "Viajes", home: "Hogar", sports: "Deportes", other: "Otros" };
