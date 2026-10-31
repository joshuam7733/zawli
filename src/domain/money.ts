// Money helpers. Amounts are integers in the currency's minor unit (see docs/DATABASE.md).
// UGX has no minor unit: 25,000 UGX is stored as 25000. KES has 2: KES 250.50 is 25050.

const exponentCache = new Map<string, number>();

/** Number of minor-unit digits for an ISO 4217 currency (UGX → 0, KES → 2). */
export function currencyExponent(currency: string): number {
  const code = currency.toUpperCase();
  let exp = exponentCache.get(code);
  if (exp === undefined) {
    try {
      exp = new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
        .maximumFractionDigits as number;
    } catch {
      exp = 2;
    }
    exponentCache.set(code, exp);
  }
  return exp;
}

export function formatMoney(amountMinor: number, currency: string, locale = "en-UG"): string {
  const exp = currencyExponent(currency);
  const major = amountMinor / 10 ** exp;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: exp,
      maximumFractionDigits: exp,
    }).format(major);
  } catch {
    return `${currency} ${major.toFixed(exp)}`;
  }
}

/** Plain number without the currency symbol, e.g. "25,000" — handy for dense tables. */
export function formatAmount(amountMinor: number, currency: string, locale = "en-UG"): string {
  const exp = currencyExponent(currency);
  return new Intl.NumberFormat(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp }).format(
    amountMinor / 10 ** exp,
  );
}

/**
 * Parses a user-typed major-unit amount ("25,000", "250.5") into minor units.
 * Returns null for anything that is not a non-negative amount with at most the
 * currency's number of decimals. Never uses floating point for the result.
 */
export function parseMoneyInput(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const cleaned = input.trim().replace(/[\s,_]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  if (frac.length > exp) {
    // Allow trailing zeros beyond the exponent ("25000.00" for UGX).
    if (!/^0*$/.test(frac.slice(exp))) return null;
  }
  const fracPadded = (frac.slice(0, exp) + "0".repeat(exp)).slice(0, exp);
  const value = Number(whole) * 10 ** exp + (exp > 0 ? Number(fracPadded) : 0);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

/** Converts minor units to an editable major-unit string ("25000", "250.50"). */
export function toMajorInput(amountMinor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(amountMinor);
  return (amountMinor / 10 ** exp).toFixed(exp);
}

/**
 * amount × bps / 10 000, rounded half-up, integer-only. 1% = 100 bps.
 * Only defined for non-negative amounts and rates.
 */
export function applyBps(amountMinor: number, bps: number): number {
  if (amountMinor < 0 || bps < 0) throw new RangeError("applyBps expects non-negative values");
  return Math.floor((amountMinor * bps + 5_000) / 10_000);
}
