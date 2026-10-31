import { applyBps } from "./money";

export interface PricingSettings {
  taxEnabled: boolean;
  taxRateBps: number;
  /** true: prices already include tax; the tax portion is reported but not added. */
  taxInclusive: boolean;
  serviceChargeEnabled: boolean;
  serviceChargeBps: number;
}

export interface OrderTotals {
  subtotalMinor: number;
  serviceChargeMinor: number;
  /** Tax added on top of the subtotal (exclusive tax). */
  taxMinor: number;
  /** Tax already contained in the prices (inclusive tax), for reporting. */
  taxIncludedMinor: number;
  totalMinor: number;
}

export function lineTotal(unitPriceMinor: number, modifiersUnitMinor: number, quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1) throw new RangeError("quantity must be a positive integer");
  return (unitPriceMinor + modifiersUnitMinor) * quantity;
}

/**
 * Order totals. Documented business rules (docs/ARCHITECTURE.md → Pricing):
 *  1. subtotal = Σ line totals (unit price + modifier deltas) × quantity
 *  2. service charge = subtotal × service-charge rate (when enabled)
 *  3. tax base = subtotal + service charge
 *  4. inclusive tax: tax portion = base × r / (1 + r), nothing is added
 *     exclusive tax: tax = base × r, added to the total
 *  5. every percentage is rounded half-up to the currency minor unit, once.
 */
export function computeOrderTotals(lineTotals: number[], s: PricingSettings): OrderTotals {
  const subtotalMinor = lineTotals.reduce((a, b) => a + b, 0);
  const serviceChargeMinor = s.serviceChargeEnabled ? applyBps(subtotalMinor, s.serviceChargeBps) : 0;
  const base = subtotalMinor + serviceChargeMinor;

  let taxMinor = 0;
  let taxIncludedMinor = 0;
  if (s.taxEnabled && s.taxRateBps > 0) {
    if (s.taxInclusive) {
      taxIncludedMinor = Math.floor(
        (base * s.taxRateBps * 2 + (10_000 + s.taxRateBps)) / (2 * (10_000 + s.taxRateBps)),
      );
    } else {
      taxMinor = applyBps(base, s.taxRateBps);
    }
  }
  return { subtotalMinor, serviceChargeMinor, taxMinor, taxIncludedMinor, totalMinor: base + taxMinor };
}
