import { describe, expect, it } from "vitest";
import {
  canTransitionOrder,
  canTransitionTicket,
  deriveOrderStatusFromTickets,
  forwardPath,
  nextTicketStatus,
} from "@/domain/order-status";
import {
  canTransitionSubscription,
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceStatusAfterPayment,
  isInvoiceOverdue,
  tenantStatusForSubscription,
} from "@/domain/billing";

describe("order state machine", () => {
  it("allows the documented happy path", () => {
    expect(canTransitionOrder("PLACED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionOrder("ACKNOWLEDGED", "PREPARING")).toBe(true);
    expect(canTransitionOrder("PREPARING", "READY")).toBe(true);
    expect(canTransitionOrder("READY", "OUT_FOR_DELIVERY")).toBe(true);
    expect(canTransitionOrder("OUT_FOR_DELIVERY", "SERVED")).toBe(true);
    expect(canTransitionOrder("SERVED", "COMPLETED")).toBe(true);
  });

  it("lets READY skip the optional OUT_FOR_DELIVERY step", () => {
    expect(canTransitionOrder("READY", "SERVED")).toBe(true);
  });

  it("rejects skipped and backward transitions", () => {
    expect(canTransitionOrder("PLACED", "READY")).toBe(false);
    expect(canTransitionOrder("PLACED", "SERVED")).toBe(false);
    expect(canTransitionOrder("PREPARING", "SERVED")).toBe(false);
    expect(canTransitionOrder("READY", "PREPARING")).toBe(false);
    expect(canTransitionOrder("SERVED", "READY")).toBe(false);
  });

  it("treats COMPLETED and CANCELLED as terminal", () => {
    for (const s of ["PLACED", "READY", "SERVED", "COMPLETED"] as const) {
      expect(canTransitionOrder("COMPLETED", s)).toBe(false);
      expect(canTransitionOrder("CANCELLED", s)).toBe(false);
    }
  });

  it("allows cancellation before serving only", () => {
    expect(canTransitionOrder("PLACED", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("READY", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("SERVED", "CANCELLED")).toBe(false);
    expect(canTransitionOrder("COMPLETED", "CANCELLED")).toBe(false);
  });

  it("computes forward paths for kitchen-driven updates", () => {
    expect(forwardPath("PLACED", "READY")).toEqual(["ACKNOWLEDGED", "PREPARING", "READY"]);
    expect(forwardPath("PREPARING", "READY")).toEqual(["READY"]);
    expect(forwardPath("READY", "PREPARING")).toEqual([]);
    expect(forwardPath("CANCELLED", "READY")).toEqual([]);
  });
});

describe("kitchen tickets", () => {
  it("moves one step at a time", () => {
    expect(canTransitionTicket("PLACED", "ACKNOWLEDGED")).toBe(true);
    expect(canTransitionTicket("PLACED", "READY")).toBe(false);
    expect(canTransitionTicket("READY", "PREPARING")).toBe(false);
    expect(nextTicketStatus("PLACED")).toBe("ACKNOWLEDGED");
    expect(nextTicketStatus("PREPARING")).toBe("READY");
    expect(nextTicketStatus("READY")).toBeNull();
  });

  it("derives the order status from several stations", () => {
    expect(deriveOrderStatusFromTickets(["PLACED", "PLACED"])).toBe("PLACED");
    expect(deriveOrderStatusFromTickets(["ACKNOWLEDGED", "PLACED"])).toBe("ACKNOWLEDGED");
    expect(deriveOrderStatusFromTickets(["READY", "PLACED"])).toBe("PREPARING");
    expect(deriveOrderStatusFromTickets(["READY", "READY"])).toBe("READY");
    expect(deriveOrderStatusFromTickets(["READY", "CANCELLED"])).toBe("READY");
    expect(deriveOrderStatusFromTickets([])).toBe("PLACED");
  });
});

describe("subscriptions", () => {
  it("follows documented transitions", () => {
    expect(canTransitionSubscription("TRIAL", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("ACTIVE", "PAST_DUE")).toBe(true);
    expect(canTransitionSubscription("PAST_DUE", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("SUSPENDED", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("CANCELLED", "ACTIVE")).toBe(true);
    expect(canTransitionSubscription("SUSPENDED", "PAST_DUE")).toBe(false);
    expect(canTransitionSubscription("CANCELLED", "TRIAL")).toBe(false);
    expect(canTransitionSubscription("ACTIVE", "TRIAL")).toBe(false);
  });

  it("maps subscription status to tenant operation", () => {
    expect(tenantStatusForSubscription("SUSPENDED", "ACTIVE")).toBe("SUSPENDED");
    expect(tenantStatusForSubscription("CANCELLED", "ACTIVE")).toBe("SUSPENDED");
    expect(tenantStatusForSubscription("ACTIVE", "SUSPENDED")).toBe("ACTIVE");
    expect(tenantStatusForSubscription("PAST_DUE", "ACTIVE")).toBeNull();
    expect(tenantStatusForSubscription("ACTIVE", "ONBOARDING")).toBeNull();
    expect(tenantStatusForSubscription("ACTIVE", "DEACTIVATED")).toBeNull();
  });
});

describe("invoices", () => {
  it("computes totals from lines", () => {
    const t = computeInvoiceTotals(
      [
        { description: "Growth plan — Oct", quantity: 1, unitPriceMinor: 350_000 },
        { description: "Extra branch", quantity: 2, unitPriceMinor: 100_000 },
      ],
      0,
    );
    expect(t.amounts).toEqual([350_000, 200_000]);
    expect(t.totalMinor).toBe(550_000);
  });

  it("rejects invalid lines", () => {
    expect(() => computeInvoiceTotals([{ description: "x", quantity: 0, unitPriceMinor: 1 }])).toThrow();
    expect(() => computeInvoiceTotals([{ description: "x", quantity: 1, unitPriceMinor: -1 }])).toThrow();
  });

  it("tracks partial and full payment, refusing overpayment", () => {
    expect(invoiceStatusAfterPayment("ISSUED", 100, 0, 40)).toEqual({ status: "PARTIALLY_PAID", amountPaidMinor: 40 });
    expect(invoiceStatusAfterPayment("PARTIALLY_PAID", 100, 40, 60)).toEqual({ status: "PAID", amountPaidMinor: 100 });
    expect(() => invoiceStatusAfterPayment("ISSUED", 100, 0, 101)).toThrow();
    expect(() => invoiceStatusAfterPayment("DRAFT", 100, 0, 10)).toThrow();
    expect(() => invoiceStatusAfterPayment("VOID", 100, 0, 10)).toThrow();
  });

  it("detects overdue invoices", () => {
    const now = new Date("2026-10-19T10:00:00Z");
    expect(isInvoiceOverdue({ status: "ISSUED", dueDate: new Date("2026-10-18T00:00:00Z") }, now)).toBe(true);
    expect(isInvoiceOverdue({ status: "PAID", dueDate: new Date("2026-10-18T00:00:00Z") }, now)).toBe(false);
    expect(isInvoiceOverdue({ status: "ISSUED", dueDate: new Date("2026-10-20T00:00:00Z") }, now)).toBe(false);
  });

  it("formats invoice numbers", () => {
    expect(formatInvoiceNumber(2026, 7)).toBe("INV-2026-00007");
  });
});
