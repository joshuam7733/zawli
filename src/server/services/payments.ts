// Pay-at-restaurant payment records (V1: no online gateway).
//
// Business rules (docs/ARCHITECTURE.md → Payments):
//  * Partial and split payments are allowed: an order may have many payment records
//    with different methods. paymentStatus = UNPAID | PARTIALLY_PAID | PAID.
//  * Overpayment is NOT recorded. For cash, staff may enter the amount tendered;
//    the change is computed and shown, but only the applied amount is recorded.
//  * Submitting or serving an order never marks it paid.
//  * Mobile money / card references are stored as typed by staff. Zawli does not
//    verify them with any provider in V1.
//  * Voiding (manager/owner) keeps the record with a reason; it is never deleted.
import { z } from "zod";
import { PaymentMethod } from "@/generated/prisma/enums";
import type { OrderPaymentStatus } from "@/generated/prisma/enums";
import { db, type Tx } from "../db";
import { requirePermission, requireWritable, type TenantContext } from "../authz";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { recordBranchEvent, signalBranch } from "../events";
import { writeAudit } from "../audit";
import { idSchema, optionalText } from "../validation";
import { completeIfServedAndPaid } from "./orders";
import { releaseToKitchen } from "./kitchen-release";

export function paymentStatusFor(totalMinor: number, paidMinor: number): OrderPaymentStatus {
  if (paidMinor <= 0) return totalMinor === 0 ? "PAID" : "UNPAID";
  return paidMinor >= totalMinor ? "PAID" : "PARTIALLY_PAID";
}

export const recordPaymentSchema = z
  .object({
    orderId: idSchema,
    amountMinor: z.coerce.number().int().positive("Enter an amount greater than zero."),
    method: z.enum(PaymentMethod),
    reference: optionalText(80),
    amountTenderedMinor: z.coerce.number().int().positive().optional().nullable(),
    note: optionalText(200),
    idempotencyKey: z.string().uuid().optional().nullable(),
  })
  .refine((p) => p.amountTenderedMinor == null || p.method === "CASH", {
    message: "Amount tendered applies to cash only.",
    path: ["amountTenderedMinor"],
  })
  .refine((p) => p.amountTenderedMinor == null || p.amountTenderedMinor >= p.amountMinor, {
    message: "Cash tendered is less than the amount being paid.",
    path: ["amountTenderedMinor"],
  });

async function applyPayment(tx: Tx, ctx: TenantContext, data: z.output<typeof recordPaymentSchema>) {
  // Serialise payments per order: concurrent recorders wait here, then see the
  // committed balance (and any payment already made with the same idempotency key).
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${data.orderId} AND "tenantId" = ${ctx.tenant.id} FOR UPDATE`;
  const order = await tx.order.findFirst({ where: { id: data.orderId, tenantId: ctx.tenant.id } });
  if (!order) throw notFound("Order");
  requirePermission(ctx, "payments.record", order.branchId);
  if (data.idempotencyKey) {
    const existing = await tx.paymentRecord.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: ctx.tenant.id, idempotencyKey: data.idempotencyKey } },
    });
    if (existing) return { payment: existing, order, duplicate: true as const };
  }
  if (order.status === "CANCELLED") throw validation("This order was cancelled; payments cannot be recorded.");
  const outstanding = order.totalMinor - order.amountPaidMinor;
  if (outstanding <= 0) throw validation("This order is already fully paid.");
  if (data.amountMinor > outstanding) {
    throw validation("The amount is more than the outstanding balance. Record only the amount applied to this order.");
  }
  const newPaid = order.amountPaidMinor + data.amountMinor;
  const status = paymentStatusFor(order.totalMinor, newPaid);
  // Optimistic lock on the paid amount: two staff recording at once cannot overpay.
  const res = await tx.order.updateMany({
    where: { id: order.id, tenantId: ctx.tenant.id, amountPaidMinor: order.amountPaidMinor },
    data: { amountPaidMinor: newPaid, paymentStatus: status },
  });
  if (res.count !== 1) throw conflict("Another payment was just recorded for this order. Refresh and try again.");
  const payment = await tx.paymentRecord.create({
    data: {
      tenantId: ctx.tenant.id,
      branchId: order.branchId,
      orderId: order.id,
      amountMinor: data.amountMinor,
      method: data.method,
      reference: data.reference,
      amountTenderedMinor: data.amountTenderedMinor ?? null,
      note: data.note,
      idempotencyKey: data.idempotencyKey ?? null,
      recordedById: ctx.user.id,
    },
  });
  await completeIfServedAndPaid(tx, order.id, ctx.tenant.id);
  // Pay-first order paid in full by staff: send it to the kitchen.
  if (order.status === "PENDING_PAYMENT" && status === "PAID") {
    await releaseToKitchen(tx, order, { type: "STAFF", id: ctx.user.id }, "Paid at the restaurant");
  }
  await writeAudit(tx, {
    tenantId: ctx.tenant.id,
    actorId: ctx.user.id,
    action: "payment.recorded",
    entityType: "PaymentRecord",
    entityId: payment.id,
    metadata: { orderReference: order.reference, amountMinor: data.amountMinor, method: data.method },
  });
  await recordBranchEvent(tx, {
    tenantId: ctx.tenant.id,
    branchId: order.branchId,
    type: "payment.recorded",
    entityId: order.id,
  });
  return { payment, order: { ...order, amountPaidMinor: newPaid, paymentStatus: status }, duplicate: false as const };
}

export async function recordPayment(ctx: TenantContext, input: z.input<typeof recordPaymentSchema>) {
  const data = recordPaymentSchema.parse(input);
  requireWritable(ctx);
  if (data.idempotencyKey) {
    const existing = await db.paymentRecord.findUnique({
      where: { tenantId_idempotencyKey: { tenantId: ctx.tenant.id, idempotencyKey: data.idempotencyKey } },
    });
    if (existing) return { paymentId: existing.id, duplicate: true, changeMinor: changeFor(existing) };
  }
  try {
    const { payment, order, duplicate } = await db.$transaction((tx) => applyPayment(tx, ctx, data));
    if (!duplicate) signalBranch(order.branchId);
    return { paymentId: payment.id, duplicate, changeMinor: changeFor(payment) };
  } catch (e) {
    if (isUniqueViolation(e) && data.idempotencyKey) {
      const existing = await db.paymentRecord.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: ctx.tenant.id, idempotencyKey: data.idempotencyKey } },
      });
      if (existing) return { paymentId: existing.id, duplicate: true, changeMinor: changeFor(existing) };
    }
    throw e;
  }
}

function changeFor(p: { amountTenderedMinor: number | null; amountMinor: number }) {
  return p.amountTenderedMinor != null ? p.amountTenderedMinor - p.amountMinor : 0;
}

export const voidPaymentSchema = z.object({
  paymentId: idSchema,
  reason: z.string().trim().min(3, "Give a reason for voiding this payment.").max(300),
});

export async function voidPayment(ctx: TenantContext, input: z.input<typeof voidPaymentSchema>) {
  const data = voidPaymentSchema.parse(input);
  const payment = await db.paymentRecord.findFirst({ where: { id: data.paymentId, tenantId: ctx.tenant.id } });
  if (!payment) throw notFound("Payment");
  requirePermission(ctx, "payments.void", payment.branchId);
  requireWritable(ctx);
  if (payment.status === "VOIDED") return;
  await db.$transaction(async (tx) => {
    const res = await tx.paymentRecord.updateMany({
      where: { id: payment.id, tenantId: ctx.tenant.id, status: "RECORDED" },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: ctx.user.id, voidReason: data.reason },
    });
    if (res.count !== 1) return;
    const order = await tx.order.findFirstOrThrow({ where: { id: payment.orderId, tenantId: ctx.tenant.id } });
    const newPaid = order.amountPaidMinor - payment.amountMinor;
    await tx.order.update({
      where: { id: order.id },
      data: { amountPaidMinor: newPaid, paymentStatus: paymentStatusFor(order.totalMinor, newPaid) },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "payment.voided",
      entityType: "PaymentRecord",
      entityId: payment.id,
      metadata: { orderReference: order.reference, amountMinor: payment.amountMinor, reason: data.reason },
    });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: payment.branchId,
      type: "payment.recorded",
      entityId: order.id,
    });
  });
  signalBranch(payment.branchId);
}

/** The bill for an open table session: every non-cancelled order and its balance. */
export async function getSessionBill(ctx: TenantContext, sessionId: string) {
  const session = await db.tableSession.findFirst({
    where: { id: idSchema.parse(sessionId), tenantId: ctx.tenant.id },
    include: {
      table: { select: { label: true } },
      orders: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { placedAt: "asc" },
        include: { items: { orderBy: { sortOrder: "asc" }, include: { modifiers: true } } },
      },
    },
  });
  if (!session) throw notFound("Table session");
  requirePermission(ctx, "payments.view", session.branchId);
  const totalMinor = session.orders.reduce((a, o) => a + o.totalMinor, 0);
  const paidMinor = session.orders.reduce((a, o) => a + o.amountPaidMinor, 0);
  return { session, totalMinor, paidMinor, outstandingMinor: totalMinor - paidMinor };
}

export const settleSessionSchema = z.object({
  sessionId: idSchema,
  method: z.enum(PaymentMethod),
  reference: optionalText(80),
  amountTenderedMinor: z.coerce.number().int().positive().optional().nullable(),
});

/**
 * Pays the full outstanding balance of every order in a table session with one
 * method (one payment record per order, in one transaction).
 */
export async function settleSession(ctx: TenantContext, input: z.input<typeof settleSessionSchema>) {
  const data = settleSessionSchema.parse(input);
  requireWritable(ctx);
  const session = await db.tableSession.findFirst({ where: { id: data.sessionId, tenantId: ctx.tenant.id } });
  if (!session) throw notFound("Table session");
  requirePermission(ctx, "payments.record", session.branchId);
  const result = await db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { tableSessionId: session.id, tenantId: ctx.tenant.id, status: { not: "CANCELLED" } },
      orderBy: { placedAt: "asc" },
    });
    const due = orders.filter((o) => o.totalMinor > o.amountPaidMinor);
    if (due.length === 0) throw validation("Nothing is outstanding for this table.");
    const totalDue = due.reduce((a, o) => a + (o.totalMinor - o.amountPaidMinor), 0);
    if (data.amountTenderedMinor != null) {
      if (data.method !== "CASH") throw validation("Amount tendered applies to cash only.");
      if (data.amountTenderedMinor < totalDue) throw validation("Cash tendered is less than the amount due.");
    }
    for (const o of due) {
      await applyPayment(tx, ctx, {
        orderId: o.id,
        amountMinor: o.totalMinor - o.amountPaidMinor,
        method: data.method,
        reference: data.reference,
        amountTenderedMinor: null,
        note: "Table bill settled",
        idempotencyKey: null,
      });
    }
    return { totalDue, changeMinor: data.amountTenderedMinor != null ? data.amountTenderedMinor - totalDue : 0 };
  });
  signalBranch(session.branchId);
  return result;
}
