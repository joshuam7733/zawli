// Staff-side order operations: kitchen tickets, controlled status transitions,
// serving, cancellation, and order queries.
import { z } from "zod";
import type { ActorType, OrderStatus, TicketStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import {
  canTransitionOrder,
  canTransitionTicket,
  deriveOrderStatusFromTickets,
  forwardPath,
  OPEN_ORDER_STATUSES,
} from "@/domain/order-status";
import { roleCanProgressKitchen } from "@/domain/permissions";
import { db, type Tx } from "../db";
import { branchesWith, can, requirePermission, requireWritable, roleAt, type TenantContext } from "../authz";
import { conflict, forbidden, notFound, validation } from "../errors";
import { recordBranchEvent, signalBranch } from "../events";
import { writeAudit } from "../audit";
import { idSchema } from "../validation";

const TIMESTAMP_FIELD: Partial<Record<OrderStatus, keyof Prisma.OrderUpdateManyMutationInput>> = {
  ACKNOWLEDGED: "acknowledgedAt",
  READY: "readyAt",
  SERVED: "servedAt",
  COMPLETED: "completedAt",
  CANCELLED: "cancelledAt",
};

interface Actor {
  type: ActorType;
  id: string | null;
}

/**
 * Moves an order from `from` to `to` if — and only if — the state machine allows
 * it and the order is still in `from` (optimistic concurrency). Records history.
 */
async function transitionOrder(
  tx: Tx,
  order: { id: string; tenantId: string; branchId: string },
  from: OrderStatus,
  to: OrderStatus,
  actor: Actor,
  reason?: string | null,
): Promise<void> {
  if (!canTransitionOrder(from, to)) throw validation(`An order cannot move from ${from} to ${to}.`);
  const now = new Date();
  const data: Prisma.OrderUpdateManyMutationInput = { status: to };
  const ts = TIMESTAMP_FIELD[to];
  if (ts) (data as Record<string, unknown>)[ts] = now;
  if (to === "CANCELLED") data.cancelReason = reason ?? null;
  const res = await tx.order.updateMany({ where: { id: order.id, tenantId: order.tenantId, status: from }, data });
  if (res.count !== 1) throw conflict("This order was updated by someone else. Refresh and try again.");
  await tx.orderStatusHistory.create({
    data: {
      tenantId: order.tenantId,
      orderId: order.id,
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      actorId: actor.id,
      reason: reason ?? null,
    },
  });
}

/** Re-derives the order's kitchen status from its tickets and moves it forward. */
async function syncOrderWithTickets(tx: Tx, orderId: string, tenantId: string, actor: Actor) {
  const order = await tx.order.findFirst({
    where: { id: orderId, tenantId },
    include: { tickets: { select: { status: true } } },
  });
  if (!order || order.status === "CANCELLED") return;
  const target = deriveOrderStatusFromTickets(order.tickets.map((t) => t.status));
  let current: OrderStatus = order.status;
  for (const step of forwardPath(current, target)) {
    await transitionOrder(tx, order, current, step, actor);
    current = step;
  }
}

// ───────────── Kitchen ─────────────

export const kitchenQuerySchema = z.object({
  branchId: idSchema,
  stationId: idSchema.optional().nullable(),
  /** Include tickets that became READY within the last N minutes. */
  recentReadyMinutes: z.coerce.number().int().min(0).max(240).default(30),
});

export async function getKitchenBoard(ctx: TenantContext, input: z.input<typeof kitchenQuerySchema>) {
  const q = kitchenQuerySchema.parse(input);
  requirePermission(ctx, "orders.view", q.branchId);
  const branch = await db.branch.findFirst({
    where: { id: q.branchId, tenantId: ctx.tenant.id },
    include: { stations: { where: { isActive: true }, orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] } },
  });
  if (!branch) throw notFound("Branch");
  const settings = await db.restaurantSettings.findUnique({ where: { tenantId: ctx.tenant.id } });
  const since = new Date(Date.now() - q.recentReadyMinutes * 60_000);
  const tickets = await db.kitchenTicket.findMany({
    where: {
      tenantId: ctx.tenant.id,
      branchId: branch.id,
      stationId: q.stationId ?? undefined,
      OR: [{ status: { in: ["PLACED", "ACKNOWLEDGED", "PREPARING"] } }, { status: "READY", readyAt: { gte: since } }],
      order: { status: { not: "CANCELLED" } },
    },
    orderBy: { createdAt: "asc" },
    include: {
      station: { select: { id: true, name: true } },
      order: {
        select: {
          id: true,
          reference: true,
          tableLabel: true,
          customerName: true,
          customerNote: true,
          placedAt: true,
          status: true,
        },
      },
      // No prices: kitchen screens never receive financial data.
      items: {
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          nameSnapshot: true,
          variantNameSnapshot: true,
          quantity: true,
          note: true,
          allergensSnapshot: true,
          modifiers: { select: { id: true, nameSnapshot: true, groupNameSnapshot: true } },
          menuItem: { select: { prepNotes: true } },
        },
      },
    },
  });
  const cursor = await latestEventId(branch.id);
  const role = roleAt(ctx, branch.id);
  return {
    branch: { id: branch.id, name: branch.name, fulfillmentMode: branch.fulfillmentMode },
    stations: branch.stations.map((s) => ({ id: s.id, name: s.name })),
    delayMinutes: settings?.kitchenDelayWarningMinutes ?? 15,
    canProgress: !!role && roleCanProgressKitchen(role, branch.fulfillmentMode) && ctx.tenant.status !== "SUSPENDED",
    serverTime: new Date().toISOString(),
    cursor,
    tickets: tickets.map((t) => ({
      id: t.id,
      status: t.status,
      createdAt: t.createdAt.toISOString(),
      acknowledgedAt: t.acknowledgedAt?.toISOString() ?? null,
      startedAt: t.startedAt?.toISOString() ?? null,
      readyAt: t.readyAt?.toISOString() ?? null,
      station: t.station,
      order: { ...t.order, placedAt: t.order.placedAt.toISOString() },
      items: t.items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        variant: i.variantNameSnapshot,
        quantity: i.quantity,
        note: i.note,
        allergens: i.allergensSnapshot,
        prepNotes: i.menuItem?.prepNotes ?? null,
        modifiers: i.modifiers.map((m) => ({ id: m.id, name: m.nameSnapshot, group: m.groupNameSnapshot })),
      })),
    })),
  };
}
export type KitchenBoard = Awaited<ReturnType<typeof getKitchenBoard>>;

export async function latestEventId(branchId: string): Promise<string> {
  const last = await db.branchEvent.findFirst({ where: { branchId }, orderBy: { id: "desc" }, select: { id: true } });
  return (last?.id ?? BigInt(0)).toString();
}

export const advanceTicketSchema = z.object({
  ticketId: idSchema,
  to: z.enum(["ACKNOWLEDGED", "PREPARING", "READY"]),
});

/**
 * Moves a kitchen ticket forward one step. Repeating the same request is a no-op
 * (safe for retries after a dropped connection); skipping steps is rejected.
 */
export async function advanceTicket(ctx: TenantContext, input: z.input<typeof advanceTicketSchema>) {
  const data = advanceTicketSchema.parse(input);
  const ticket = await db.kitchenTicket.findFirst({
    where: { id: data.ticketId, tenantId: ctx.tenant.id },
    include: { branch: { select: { fulfillmentMode: true } } },
  });
  if (!ticket) throw notFound("Ticket");
  const role = roleAt(ctx, ticket.branchId);
  if (!role || !roleCanProgressKitchen(role, ticket.branch.fulfillmentMode)) throw forbidden();
  requireWritable(ctx);

  if (ticket.status === data.to) return { status: ticket.status, changed: false };
  if (!canTransitionTicket(ticket.status, data.to as TicketStatus)) {
    throw validation(`This ticket is ${ticket.status.toLowerCase()} and cannot move to ${data.to.toLowerCase()}.`);
  }
  const now = new Date();
  await db.$transaction(async (tx) => {
    const res = await tx.kitchenTicket.updateMany({
      where: { id: ticket.id, tenantId: ctx.tenant.id, status: ticket.status },
      data: {
        status: data.to,
        acknowledgedAt: data.to === "ACKNOWLEDGED" ? now : undefined,
        startedAt: data.to === "PREPARING" ? now : undefined,
        readyAt: data.to === "READY" ? now : undefined,
      },
    });
    if (res.count !== 1) throw conflict("This ticket was updated by someone else. Refresh and try again.");
    await syncOrderWithTickets(tx, ticket.orderId, ctx.tenant.id, { type: "STAFF", id: ctx.user.id });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: ticket.branchId,
      type: "ticket.updated",
      entityId: ticket.id,
    });
  });
  signalBranch(ticket.branchId);
  return { status: data.to, changed: true };
}

// ───────────── Floor (serving) ─────────────

export const serveSchema = z.object({ orderId: idSchema, to: z.enum(["OUT_FOR_DELIVERY", "SERVED"]) });

export async function markOrderServing(ctx: TenantContext, input: z.input<typeof serveSchema>) {
  const data = serveSchema.parse(input);
  const order = await db.order.findFirst({ where: { id: data.orderId, tenantId: ctx.tenant.id } });
  if (!order) throw notFound("Order");
  requirePermission(ctx, "orders.serve", order.branchId);
  requireWritable(ctx);
  if (order.status === data.to) return { status: order.status, changed: false };
  await db.$transaction(async (tx) => {
    await transitionOrder(tx, order, order.status, data.to, { type: "STAFF", id: ctx.user.id });
    // Already fully paid (pay-first restaurants): served completes the order.
    if (data.to === "SERVED" && order.paymentStatus === "PAID") {
      await transitionOrder(tx, order, "SERVED", "COMPLETED", { type: "SYSTEM", id: null }, "Served and fully paid");
    }
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: order.branchId,
      type: "order.updated",
      entityId: order.id,
    });
  });
  signalBranch(order.branchId);
  return { status: data.to, changed: true };
}

export const cancelSchema = z.object({
  orderId: idSchema,
  reason: z.string().trim().min(3, "Give a reason for cancelling.").max(300),
});

/**
 * Cancels an order that has not been served. Orders with recorded (non-voided)
 * payments must have those payments voided first — refunds are handled outside
 * Zawli in V1 and documented on the voided payment.
 */
export async function cancelOrder(ctx: TenantContext, input: z.input<typeof cancelSchema>) {
  const data = cancelSchema.parse(input);
  const order = await db.order.findFirst({ where: { id: data.orderId, tenantId: ctx.tenant.id } });
  if (!order) throw notFound("Order");
  requirePermission(ctx, "orders.cancel", order.branchId);
  requireWritable(ctx);
  if (order.status === "CANCELLED") return;
  if (order.amountPaidMinor > 0)
    throw validation("This order has recorded payments. Void them (and refund the customer) before cancelling.");
  await db.$transaction(async (tx) => {
    await transitionOrder(tx, order, order.status, "CANCELLED", { type: "STAFF", id: ctx.user.id }, data.reason);
    await tx.kitchenTicket.updateMany({
      where: { orderId: order.id, tenantId: ctx.tenant.id, status: { not: "READY" } },
      data: { status: "CANCELLED" },
    });
    await tx.printJob.updateMany({
      where: { ticket: { orderId: order.id }, tenantId: ctx.tenant.id, status: "PENDING" },
      data: { status: "CANCELLED" },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "order.cancelled",
      entityType: "Order",
      entityId: order.id,
      metadata: { reference: order.reference, reason: data.reason },
    });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: order.branchId,
      type: "order.updated",
      entityId: order.id,
    });
  });
  signalBranch(order.branchId);
}

/** Completes a served, fully paid order (normally automatic after payment). */
export async function completeOrder(ctx: TenantContext, input: { orderId: string }) {
  const order = await db.order.findFirst({ where: { id: idSchema.parse(input.orderId), tenantId: ctx.tenant.id } });
  if (!order) throw notFound("Order");
  requirePermission(ctx, "orders.serve", order.branchId);
  requireWritable(ctx);
  if (order.status === "COMPLETED") return;
  if (order.paymentStatus !== "PAID") throw validation("Record full payment before completing this order.");
  await db.$transaction(async (tx) => {
    await transitionOrder(tx, order, order.status, "COMPLETED", { type: "STAFF", id: ctx.user.id });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: order.branchId,
      type: "order.updated",
      entityId: order.id,
    });
  });
  signalBranch(order.branchId);
}

/** Used by payments: completes SERVED orders once fully paid. */
export async function completeIfServedAndPaid(tx: Tx, orderId: string, tenantId: string) {
  const order = await tx.order.findFirst({ where: { id: orderId, tenantId } });
  if (order && order.status === "SERVED" && order.paymentStatus === "PAID") {
    await transitionOrder(tx, order, "SERVED", "COMPLETED", { type: "SYSTEM", id: null }, "Served and fully paid");
  }
}

// ───────────── Queries ─────────────

export const listOrdersSchema = z.object({
  branchId: idSchema.optional().nullable(),
  scope: z.enum(["open", "today", "all"]).default("open"),
  status: z.string().optional().nullable(),
  q: z.string().trim().max(40).optional().nullable(),
  take: z.coerce.number().int().min(1).max(200).default(100),
});

export async function listOrders(ctx: TenantContext, input: z.input<typeof listOrdersSchema>) {
  const f = listOrdersSchema.parse(input);
  const allowed = branchesWith(ctx, "orders.view");
  const branchIds = f.branchId ? allowed.filter((b) => b === f.branchId) : allowed;
  if (branchIds.length === 0) return [];
  const where: Prisma.OrderWhereInput = { tenantId: ctx.tenant.id, branchId: { in: branchIds } };
  if (f.scope === "open") where.status = { in: [...OPEN_ORDER_STATUSES] };
  if (f.scope === "today") where.placedAt = { gte: startOfDayInZone(new Date(), ctx.tenant.timezone) };
  if (f.status && (OPEN_ORDER_STATUSES as readonly string[]).concat(["COMPLETED", "CANCELLED"]).includes(f.status))
    where.status = f.status as OrderStatus;
  if (f.q) where.OR = [{ reference: { contains: f.q } }, { tableLabel: { equals: f.q, mode: "insensitive" } }];
  const showMoney = branchIds.every((b) => can(ctx, "payments.view", b));
  const orders = await db.order.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: f.take,
    include: {
      branch: { select: { name: true } },
      items: { select: { quantity: true } },
      tickets: { select: { status: true, station: { select: { name: true } } } },
    },
  });
  return orders.map((o) => ({
    id: o.id,
    reference: o.reference,
    status: o.status,
    paymentStatus: showMoney ? o.paymentStatus : null,
    totalMinor: showMoney ? o.totalMinor : null,
    currency: o.currency,
    tableLabel: o.tableLabel,
    branchName: o.branch.name,
    branchId: o.branchId,
    placedAt: o.placedAt,
    itemCount: o.items.reduce((a, i) => a + i.quantity, 0),
    tickets: o.tickets.map((t) => ({ status: t.status, station: t.station.name })),
  }));
}

export async function getOrderDetail(ctx: TenantContext, orderId: string) {
  const order = await db.order.findFirst({
    where: { id: idSchema.parse(orderId), tenantId: ctx.tenant.id },
    include: {
      branch: { select: { id: true, name: true, fulfillmentMode: true } },
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: true, station: { select: { name: true } } } },
      statusHistory: { orderBy: { createdAt: "asc" }, include: { actor: { select: { name: true } } } },
      tickets: {
        include: {
          station: { select: { name: true } },
          printJobs: { include: { printer: { select: { name: true } } } },
        },
      },
      payments: {
        orderBy: { recordedAt: "asc" },
        include: { recordedBy: { select: { name: true } }, voidedBy: { select: { name: true } } },
      },
    },
  });
  if (!order) throw notFound("Order");
  requirePermission(ctx, "orders.view", order.branchId);
  const showMoney = can(ctx, "payments.view", order.branchId);
  if (!showMoney) {
    // Kitchen staff: strip financial data.
    return {
      ...order,
      payments: [],
      subtotalMinor: null,
      serviceChargeMinor: null,
      taxMinor: null,
      taxIncludedMinor: null,
      totalMinor: null,
      amountPaidMinor: null,
      items: order.items.map((i) => ({ ...i, unitPriceMinor: null, modifiersUnitMinor: null, lineTotalMinor: null })),
      showMoney,
    };
  }
  return { ...order, showMoney };
}

export function startOfDayInZone(date: Date, timeZone: string): Date {
  // Midnight of `date`'s calendar day in `timeZone`, as a UTC instant.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  const offsetMs = asUtc - Math.floor(date.getTime() / 1000) * 1000;
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day")) - offsetMs);
}
