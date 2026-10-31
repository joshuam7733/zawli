import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { placeOrder } from "@/server/services/ordering";
import {
  advanceTicket,
  cancelOrder,
  completeOrder,
  getKitchenBoard,
  getOrderDetail,
  markOrderServing,
} from "@/server/services/orders";
import { getSessionBill, recordPayment, settleSession, voidPayment } from "@/server/services/payments";
import { getFloorBoard, updateServiceRequest } from "@/server/services/floor";
import { createServiceRequest } from "@/server/services/ordering";
import { makeRestaurant, sampleCart, SAMPLE_CART_TOTAL, type TestRestaurant } from "../helpers/fixtures";

let r: TestRestaurant;
beforeAll(async () => {
  r = await makeRestaurant({ name: "Kitchen Test Grill" });
});

async function newOrder(rest = r) {
  const res = await placeOrder(sampleCart(rest));
  return db.order.findUniqueOrThrow({ where: { publicToken: res.publicToken }, include: { tickets: true } });
}

describe("kitchen display", () => {
  it("shows new tickets with items, modifiers, notes and allergies — but no prices", async () => {
    const order = await newOrder();
    const board = await getKitchenBoard(r.kitchen, { branchId: r.branchId });
    const ticket = board.tickets.find((t) => t.order.id === order.id)!;
    expect(ticket.status).toBe("PLACED");
    expect(ticket.order.tableLabel).toBe("T1");
    const burger = ticket.items.find((i) => i.name === "Burger")!;
    expect(burger).toMatchObject({ variant: "Large", quantity: 1, note: "No onions", allergens: "Gluten" });
    expect(burger.modifiers.map((m) => m.name).sort()).toEqual(["Cheese", "Salad"]);
    const json = JSON.stringify(board);
    expect(json).not.toMatch(/Minor|price|total/i);
    expect(board.canProgress).toBe(true);
  });

  it("moves tickets step by step, updates the order and records who did it", async () => {
    const order = await newOrder();
    const ticketId = order.tickets[0].id;
    await advanceTicket(r.kitchen, { ticketId, to: "ACKNOWLEDGED" });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("ACKNOWLEDGED");
    await advanceTicket(r.kitchen, { ticketId, to: "PREPARING" });
    await advanceTicket(r.kitchen, { ticketId, to: "READY" });
    const after = await db.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { statusHistory: { orderBy: { createdAt: "asc" } } },
    });
    expect(after.status).toBe("READY");
    expect(after.readyAt).not.toBeNull();
    expect(after.statusHistory.map((h) => h.toStatus)).toEqual(["PLACED", "ACKNOWLEDGED", "PREPARING", "READY"]);
    expect(after.statusHistory.slice(1).every((h) => h.actorId === r.kitchen.user.id && h.fromStatus)).toBe(true);
  });

  it("rejects skipped steps", async () => {
    const order = await newOrder();
    await expect(advanceTicket(r.kitchen, { ticketId: order.tickets[0].id, to: "READY" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("treats repeated requests as no-ops (safe retries after reconnect)", async () => {
    const order = await newOrder();
    const ticketId = order.tickets[0].id;
    const first = await advanceTicket(r.kitchen, { ticketId, to: "ACKNOWLEDGED" });
    const again = await advanceTicket(r.kitchen, { ticketId, to: "ACKNOWLEDGED" });
    expect(first.changed).toBe(true);
    expect(again.changed).toBe(false);
    const history = await db.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "ACKNOWLEDGED" } });
    expect(history).toBe(1);
  });

  it("handles concurrent identical updates without double transitions", async () => {
    const order = await newOrder();
    const ticketId = order.tickets[0].id;
    const results = await Promise.allSettled([
      advanceTicket(r.kitchen, { ticketId, to: "ACKNOWLEDGED" }),
      advanceTicket(r.manager, { ticketId, to: "ACKNOWLEDGED" }),
    ]);
    expect(results.some((x) => x.status === "fulfilled")).toBe(true);
    expect(await db.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "ACKNOWLEDGED" } })).toBe(1);
  });

  it("does not let waiters progress tickets when a kitchen screen is used", async () => {
    const order = await newOrder();
    await expect(advanceTicket(r.waiter, { ticketId: order.tickets[0].id, to: "ACKNOWLEDGED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets waiters progress tickets in MANUAL mode", async () => {
    const manual = await makeRestaurant({ mode: "MANUAL" });
    const order = await newOrder(manual);
    await expect(
      advanceTicket(manual.waiter, { ticketId: order.tickets[0].id, to: "ACKNOWLEDGED" }),
    ).resolves.toMatchObject({ changed: true });
  });
});

describe("serving and floor", () => {
  it("serves a ready order and shows ready orders on the floor board", async () => {
    const order = await newOrder();
    for (const to of ["ACKNOWLEDGED", "PREPARING", "READY"] as const)
      await advanceTicket(r.kitchen, { ticketId: order.tickets[0].id, to });
    const board = await getFloorBoard(r.waiter, r.branchId);
    expect(board.orders.find((o) => o.id === order.id)?.status).toBe("READY");
    await markOrderServing(r.waiter, { orderId: order.id, to: "SERVED" });
    const served = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(served.status).toBe("SERVED");
    expect(served.paymentStatus).toBe("UNPAID"); // serving never marks paid
  });

  it("rejects serving an order that is not ready", async () => {
    const order = await newOrder();
    await expect(markOrderServing(r.waiter, { orderId: order.id, to: "SERVED" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("does not let kitchen staff serve or cancel", async () => {
    const order = await newOrder();
    await expect(markOrderServing(r.kitchen, { orderId: order.id, to: "SERVED" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(cancelOrder(r.kitchen, { orderId: order.id, reason: "test" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(cancelOrder(r.waiter, { orderId: order.id, reason: "test" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("lets a manager cancel an unpaid order with a reason; kitchen tickets are cancelled", async () => {
    const order = await newOrder();
    await cancelOrder(r.manager, { orderId: order.id, reason: "Customer left" });
    const after = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { tickets: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toBe("Customer left");
    expect(after.tickets.every((t) => t.status === "CANCELLED")).toBe(true);
    await expect(advanceTicket(r.kitchen, { ticketId: order.tickets[0].id, to: "ACKNOWLEDGED" })).rejects.toThrow();
  });

  it("acknowledges and resolves waiter calls", async () => {
    await createServiceRequest({ token: r.table2Token, type: "ASSISTANCE" });
    const board = await getFloorBoard(r.waiter, r.branchId);
    const req = board.requests.find((x) => x.tableLabel === "T2" && x.type === "ASSISTANCE")!;
    await updateServiceRequest(r.waiter, { requestId: req.id, action: "acknowledge" });
    await updateServiceRequest(r.waiter, { requestId: req.id, action: "resolve" });
    const row = await db.serviceRequest.findUniqueOrThrow({ where: { id: req.id } });
    expect(row.status).toBe("RESOLVED");
    expect(row.resolvedById).toBe(r.waiter.user.id);
    await expect(updateServiceRequest(r.kitchen, { requestId: req.id, action: "resolve" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("payments at the restaurant", () => {
  it("records partial and split payments and completes a served order when fully paid", async () => {
    const order = await newOrder();
    for (const to of ["ACKNOWLEDGED", "PREPARING", "READY"] as const)
      await advanceTicket(r.kitchen, { ticketId: order.tickets[0].id, to });
    await markOrderServing(r.waiter, { orderId: order.id, to: "SERVED" });

    await recordPayment(r.waiter, {
      orderId: order.id,
      amountMinor: 20_000,
      method: "CASH",
      amountTenderedMinor: 50_000,
    });
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.paymentStatus).toBe("PARTIALLY_PAID");
    expect(o.status).toBe("SERVED");

    const second = await recordPayment(r.waiter, {
      orderId: order.id,
      amountMinor: SAMPLE_CART_TOTAL - 20_000,
      method: "MOBILE_MONEY",
      reference: "MM123",
    });
    expect(second.changeMinor).toBe(0);
    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { payments: true } });
    expect(paid.paymentStatus).toBe("PAID");
    expect(paid.status).toBe("COMPLETED");
    expect(paid.payments.map((p) => p.method).sort()).toEqual(["CASH", "MOBILE_MONEY"]);
    expect(paid.payments.every((p) => p.recordedById === r.waiter.user.id)).toBe(true);
  });

  it("computes change for cash but records only the applied amount", async () => {
    const order = await newOrder();
    const res = await recordPayment(r.waiter, {
      orderId: order.id,
      amountMinor: SAMPLE_CART_TOTAL,
      method: "CASH",
      amountTenderedMinor: 50_000,
    });
    expect(res.changeMinor).toBe(50_000 - SAMPLE_CART_TOTAL);
    const p = await db.paymentRecord.findUniqueOrThrow({ where: { id: res.paymentId } });
    expect(p.amountMinor).toBe(SAMPLE_CART_TOTAL);
    // Paid before being served: stays in the kitchen flow, not completed.
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PLACED");
  });

  it("rejects overpayment and payments on cancelled orders", async () => {
    const order = await newOrder();
    await expect(
      recordPayment(r.waiter, { orderId: order.id, amountMinor: SAMPLE_CART_TOTAL + 1, method: "CARD" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await cancelOrder(r.manager, { orderId: order.id, reason: "Duplicate" });
    await expect(
      recordPayment(r.waiter, { orderId: order.id, amountMinor: 100, method: "CARD" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("deduplicates a double-clicked payment with the same idempotency key", async () => {
    const order = await newOrder();
    const key = randomUUID();
    const [a, b] = await Promise.all([
      recordPayment(r.waiter, { orderId: order.id, amountMinor: 1_000, method: "CASH", idempotencyKey: key }),
      recordPayment(r.waiter, { orderId: order.id, amountMinor: 1_000, method: "CASH", idempotencyKey: key }),
    ]);
    expect(a.paymentId).toBe(b.paymentId);
    expect(await db.paymentRecord.count({ where: { orderId: order.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).amountPaidMinor).toBe(1_000);
  });

  it("never lets concurrent payments exceed the total", async () => {
    const order = await newOrder();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        recordPayment(r.manager, { orderId: order.id, amountMinor: 20_000, method: "CASH" }),
      ),
    );
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.amountPaidMinor).toBeLessThanOrEqual(o.totalMinor);
    expect(results.filter((x) => x.status === "fulfilled").length).toBe(1);
  });

  it("lets managers (not waiters) void a payment, keeping the record", async () => {
    const order = await newOrder();
    const { paymentId } = await recordPayment(r.waiter, { orderId: order.id, amountMinor: 5_000, method: "CARD" });
    await expect(voidPayment(r.waiter, { paymentId, reason: "Wrong order" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await voidPayment(r.manager, { paymentId, reason: "Wrong order" });
    const p = await db.paymentRecord.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("VOIDED");
    expect(p.voidedById).toBe(r.manager.user.id);
    const o = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(o.amountPaidMinor).toBe(0);
    expect(o.paymentStatus).toBe("UNPAID");
    expect(await db.auditLog.count({ where: { entityId: paymentId, action: "payment.voided" } })).toBe(1);
  });

  it("settles a whole table bill in one go", async () => {
    const t = await makeRestaurant();
    await placeOrder(sampleCart(t));
    await placeOrder(sampleCart(t));
    const session = await db.tableSession.findFirstOrThrow({ where: { tableId: t.tableId, status: "OPEN" } });
    const bill = await getSessionBill(t.waiter, session.id);
    expect(bill.outstandingMinor).toBe(2 * SAMPLE_CART_TOTAL);
    const res = await settleSession(t.waiter, { sessionId: session.id, method: "CASH", amountTenderedMinor: 100_000 });
    expect(res.changeMinor).toBe(100_000 - 2 * SAMPLE_CART_TOTAL);
    const after = await getSessionBill(t.waiter, session.id);
    expect(after.outstandingMinor).toBe(0);
  });

  it("only completes orders that are paid", async () => {
    const order = await newOrder();
    for (const to of ["ACKNOWLEDGED", "PREPARING", "READY"] as const)
      await advanceTicket(r.kitchen, { ticketId: order.tickets[0].id, to });
    await markOrderServing(r.waiter, { orderId: order.id, to: "SERVED" });
    await expect(completeOrder(r.waiter, { orderId: order.id })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("hides financial data from kitchen staff in order detail", async () => {
    const order = await newOrder();
    await recordPayment(r.waiter, { orderId: order.id, amountMinor: 1_000, method: "CASH" });
    const detail = await getOrderDetail(r.kitchen, order.id);
    expect(detail.totalMinor).toBeNull();
    expect(detail.payments).toEqual([]);
    expect(detail.items.every((i) => i.lineTotalMinor === null)).toBe(true);
  });
});
