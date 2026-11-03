/** UI boundary only; PostgreSQL and the financial domain still validate ranges.
 * Comma and dot are decimal separators, never thousands separators. */
export function normalizeDecimalInput(value: string, maxFractionDigits = 6): string {
  const trimmed = value.trim();
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 6) throw new Error("Precisión decimal no válida.");
  const pattern = maxFractionDigits === 0 ? /^[0-9]+$/ : new RegExp(`^[0-9]+(?:[.,][0-9]{1,${maxFractionDigits}})?$`);
  if (!pattern.test(trimmed)) throw new Error(`Usá un número sin separadores de miles${maxFractionDigits ? ` y con hasta ${maxFractionDigits} decimales (coma o punto)` : ""}.`);
  return trimmed.replace(",", ".");
}
