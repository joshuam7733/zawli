// Waiter / floor operations: table overview, ready orders, waiter calls, bill requests.
import { z } from "zod";
import { OPEN_ORDER_STATUSES } from "@/domain/order-status";
import { db } from "../db";
import { can, requirePermission, requireWritable, type TenantContext } from "../authz";
import { notFound, validation } from "../errors";
import { recordBranchEvent, signalBranch } from "../events";
import { idSchema } from "../validation";
import { latestEventId } from "./orders";

export async function getFloorBoard(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "orders.view", idSchema.parse(branchId));
  const branch = await db.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  const settings = await db.restaurantSettings.findUnique({ where: { tenantId: ctx.tenant.id } });
  const idleMs = (settings?.tableSessionIdleMinutes ?? 180) * 60_000;
  const showMoney = can(ctx, "payments.view", branch.id);

  const [tables, orders, requests, cursor] = await Promise.all([
    db.diningTable.findMany({
      where: { tenantId: ctx.tenant.id, branchId: branch.id, isActive: true },
      orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
      include: { sessions: { where: { status: "OPEN" } } },
    }),
    db.order.findMany({
      where: { tenantId: ctx.tenant.id, branchId: branch.id, status: { in: [...OPEN_ORDER_STATUSES] } },
      orderBy: { placedAt: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            nameSnapshot: true,
            variantNameSnapshot: true,
            quantity: true,
            note: true,
            allergensSnapshot: true,
            modifiers: { select: { nameSnapshot: true } },
          },
        },
      },
    }),
    db.serviceRequest.findMany({
      where: { tenantId: ctx.tenant.id, branchId: branch.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: { createdAt: "asc" },
      include: { table: { select: { label: true } }, acknowledgedBy: { select: { name: true } } },
    }),
    latestEventId(branch.id),
  ]);

  const now = Date.now();
  return {
    branch: { id: branch.id, name: branch.name, fulfillmentMode: branch.fulfillmentMode },
    serverTime: new Date().toISOString(),
    cursor,
    canServe: can(ctx, "orders.serve", branch.id) && ctx.tenant.status !== "SUSPENDED",
    canRecordPayments: can(ctx, "payments.record", branch.id) && ctx.tenant.status !== "SUSPENDED",
    showMoney,
    currency: ctx.tenant.currency,
    tables: tables.map((t) => {
      const s = t.sessions[0];
      const tableOrders = orders.filter((o) => o.tableId === t.id);
      return {
        id: t.id,
        label: t.label,
        area: t.area,
        session: s
          ? {
              id: s.id,
              openedAt: s.openedAt.toISOString(),
              lastActivityAt: s.lastActivityAt.toISOString(),
              stale: now - s.lastActivityAt.getTime() > idleMs,
            }
          : null,
        openOrders: tableOrders.length,
        readyOrders: tableOrders.filter((o) => o.status === "READY").length,
        outstandingMinor: showMoney ? tableOrders.reduce((a, o) => a + (o.totalMinor - o.amountPaidMinor), 0) : null,
        requests: requests.filter((r) => r.tableId === t.id).map((r) => r.type),
      };
    }),
    orders: orders.map((o) => ({
      id: o.id,
      reference: o.reference,
      status: o.status,
      tableLabel: o.tableLabel,
      tableSessionId: o.tableSessionId,
      customerName: o.customerName,
      customerNote: o.customerNote,
      placedAt: o.placedAt.toISOString(),
      readyAt: o.readyAt?.toISOString() ?? null,
      paymentStatus: showMoney ? o.paymentStatus : null,
      totalMinor: showMoney ? o.totalMinor : null,
      amountPaidMinor: showMoney ? o.amountPaidMinor : null,
      items: o.items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        variant: i.variantNameSnapshot,
        quantity: i.quantity,
        note: i.note,
        allergens: i.allergensSnapshot,
        modifiers: i.modifiers.map((m) => m.nameSnapshot),
      })),
    })),
    requests: requests.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      note: r.note,
      tableLabel: r.table.label,
      tableSessionId: r.tableSessionId,
      createdAt: r.createdAt.toISOString(),
      acknowledgedBy: r.acknowledgedBy?.name ?? null,
    })),
  };
}
export type FloorBoard = Awaited<ReturnType<typeof getFloorBoard>>;

export const updateServiceRequestSchema = z.object({
  requestId: idSchema,
  action: z.enum(["acknowledge", "resolve", "cancel"]),
});

export async function updateServiceRequest(ctx: TenantContext, input: z.input<typeof updateServiceRequestSchema>) {
  const data = updateServiceRequestSchema.parse(input);
  const req = await db.serviceRequest.findFirst({ where: { id: data.requestId, tenantId: ctx.tenant.id } });
  if (!req) throw notFound("Request");
  requirePermission(ctx, "service.handle", req.branchId);
  requireWritable(ctx);
  const now = new Date();
  const final = req.status === "RESOLVED" || req.status === "CANCELLED";
  if (final) return { status: req.status, changed: false };
  if (data.action === "acknowledge" && req.status === "ACKNOWLEDGED") return { status: req.status, changed: false };

  const update =
    data.action === "acknowledge"
      ? { status: "ACKNOWLEDGED" as const, acknowledgedAt: now, acknowledgedById: ctx.user.id }
      : data.action === "resolve"
        ? {
            status: "RESOLVED" as const,
            resolvedAt: now,
            resolvedById: ctx.user.id,
            acknowledgedAt: req.acknowledgedAt ?? now,
            acknowledgedById: req.acknowledgedById ?? ctx.user.id,
          }
        : { status: "CANCELLED" as const, resolvedAt: now, resolvedById: ctx.user.id };
  if (data.action === "acknowledge" && req.status !== "OPEN") throw validation("This request is no longer open.");

  await db.$transaction(async (tx) => {
    await tx.serviceRequest.updateMany({
      where: { id: req.id, tenantId: ctx.tenant.id, status: req.status },
      data: update,
    });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: req.branchId,
      type: "service.updated",
      entityId: req.id,
    });
  });
  signalBranch(req.branchId);
  return { status: update.status, changed: true };
}
