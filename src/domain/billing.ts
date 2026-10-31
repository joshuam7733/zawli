// Platform subscription and invoice rules. Pure functions — no I/O.
import type { InvoiceStatus, SubscriptionStatus, TenantStatus } from "@/generated/prisma/enums";

const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  TRIAL: ["ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"],
  ACTIVE: ["PAST_DUE", "SUSPENDED", "CANCELLED"],
  PAST_DUE: ["ACTIVE", "SUSPENDED", "CANCELLED"],
  SUSPENDED: ["ACTIVE", "CANCELLED"],
  CANCELLED: ["ACTIVE"],
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return SUBSCRIPTION_TRANSITIONS[from].includes(to);
}

export function allowedSubscriptionTransitions(from: SubscriptionStatus): readonly SubscriptionStatus[] {
  return SUBSCRIPTION_TRANSITIONS[from];
}

/**
 * Operational effect of a subscription status on the tenant (docs/SECURITY.md →
 * Suspension). SUSPENDED and CANCELLED put the tenant in SUSPENDED (read-only,
 * public ordering off, data kept and exportable). Returning to ACTIVE restores it.
 * Returns null when the tenant status should not change.
 */
export function tenantStatusForSubscription(sub: SubscriptionStatus, currentTenant: TenantStatus): TenantStatus | null {
  if (currentTenant === "DEACTIVATED" || currentTenant === "ONBOARDING") return null;
  if (sub === "SUSPENDED" || sub === "CANCELLED") return currentTenant === "SUSPENDED" ? null : "SUSPENDED";
  if (sub === "ACTIVE" || sub === "TRIAL" || sub === "PAST_DUE") return currentTenant === "SUSPENDED" ? "ACTIVE" : null;
  return null;
}

export interface InvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceMinor: number;
}

export function computeInvoiceTotals(lines: readonly InvoiceLineInput[], taxMinor = 0) {
  for (const l of lines) {
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new RangeError("Invalid invoice line quantity");
    if (!Number.isInteger(l.unitPriceMinor) || l.unitPriceMinor < 0) throw new RangeError("Invalid unit price");
  }
  if (!Number.isInteger(taxMinor) || taxMinor < 0) throw new RangeError("Invalid tax amount");
  const amounts = lines.map((l) => l.quantity * l.unitPriceMinor);
  const subtotalMinor = amounts.reduce((a, b) => a + b, 0);
  return { amounts, subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor };
}

/** Invoice status after a payment of `amountMinor` is recorded. Throws on overpayment. */
export function invoiceStatusAfterPayment(
  status: InvoiceStatus,
  totalMinor: number,
  paidMinor: number,
  amountMinor: number,
): { status: InvoiceStatus; amountPaidMinor: number } {
  if (status !== "ISSUED" && status !== "PARTIALLY_PAID") {
    throw new Error(`Cannot record a payment on a ${status} invoice`);
  }
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new RangeError("Payment must be positive");
  const amountPaidMinor = paidMinor + amountMinor;
  if (amountPaidMinor > totalMinor) throw new RangeError("Payment exceeds the outstanding balance");
  return { status: amountPaidMinor === totalMinor ? "PAID" : "PARTIALLY_PAID", amountPaidMinor };
}

export function isInvoiceOverdue(inv: { status: InvoiceStatus; dueDate: Date }, now = new Date()): boolean {
  return (inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID") && inv.dueDate.getTime() < now.getTime();
}

export function formatInvoiceNumber(year: number, seq: number): string {
  return `INV-${year}-${String(seq).padStart(5, "0")}`;
}
