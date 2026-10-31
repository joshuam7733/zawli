// Dashboard and reports. Definitions (shown in the UI as well):
//  * Order value — Σ totals of orders PLACED in the period, excluding cancelled.
//  * Collected   — Σ payment records (not voided) RECORDED in the period.
//  * Outstanding — order value of non-cancelled orders in the period minus what was paid on them.
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "../db";
import { branchesWith, requirePermission, requirePlatform, type SessionUser, type TenantContext } from "../authz";
import { idSchema } from "../validation";
import { startOfDayInZone } from "./orders";

export const reportRangeSchema = z.object({
  range: z.enum(["today", "7d", "30d"]).default("today"),
  branchId: idSchema.optional().nullable(),
});

export function rangeStart(range: "today" | "7d" | "30d", timeZone: string, now = new Date()): Date {
  const today = startOfDayInZone(now, timeZone);
  if (range === "today") return today;
  const days = range === "7d" ? 6 : 29;
  return startOfDayInZone(new Date(today.getTime() - days * 86_400_000 + 12 * 3600_000), timeZone);
}

export async function getDashboard(ctx: TenantContext, input: z.input<typeof reportRangeSchema>) {
  const f = reportRangeSchema.parse(input);
  requirePermission(ctx, "reports.view", f.branchId ?? undefined);
  const allowed = branchesWith(ctx, "reports.view");
  const branchIds = f.branchId ? allowed.filter((b) => b === f.branchId) : allowed;
  const tenantId = ctx.tenant.id;
  const from = rangeStart(f.range, ctx.tenant.timezone);
  const orderWhere: Prisma.OrderWhereInput = { tenantId, branchId: { in: branchIds }, placedAt: { gte: from } };
  const settings = await db.restaurantSettings.findUnique({ where: { tenantId } });
  const delayCutoff = new Date(Date.now() - (settings?.kitchenDelayWarningMinutes ?? 15) * 60_000);

  const [
    byStatus,
    valueAgg,
    collectedAgg,
    byMethod,
    popular,
    branches,
    waitingTickets,
    delayedTickets,
    recent,
    openRequests,
    unavailable,
  ] = await Promise.all([
    db.order.groupBy({ by: ["status"], where: orderWhere, _count: { _all: true } }),
    db.order.aggregate({
      where: { ...orderWhere, status: { not: "CANCELLED" } },
      _sum: {
        totalMinor: true,
        amountPaidMinor: true,
        taxMinor: true,
        taxIncludedMinor: true,
        serviceChargeMinor: true,
      },
      _avg: { totalMinor: true },
    }),
    db.paymentRecord.aggregate({
      where: { tenantId, branchId: { in: branchIds }, status: "RECORDED", recordedAt: { gte: from } },
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.paymentRecord.groupBy({
      by: ["method"],
      where: { tenantId, branchId: { in: branchIds }, status: "RECORDED", recordedAt: { gte: from } },
      _sum: { amountMinor: true },
    }),
    db.orderItem.groupBy({
      by: ["nameSnapshot"],
      where: { tenantId, order: { ...orderWhere, status: { not: "CANCELLED" } } },
      _sum: { quantity: true, lineTotalMinor: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 8,
    }),
    db.order.groupBy({
      by: ["branchId"],
      where: { ...orderWhere, status: { not: "CANCELLED" } },
      _count: { _all: true },
      _sum: { totalMinor: true },
    }),
    db.kitchenTicket.count({
      where: { tenantId, branchId: { in: branchIds }, status: { in: ["PLACED", "ACKNOWLEDGED", "PREPARING"] } },
    }),
    db.kitchenTicket.count({
      where: {
        tenantId,
        branchId: { in: branchIds },
        status: { in: ["PLACED", "ACKNOWLEDGED", "PREPARING"] },
        createdAt: { lt: delayCutoff },
      },
    }),
    db.orderStatusHistory.findMany({
      where: { tenantId, order: { branchId: { in: branchIds } } },
      orderBy: { createdAt: "desc" },
      take: 12,
      include: {
        order: { select: { id: true, reference: true, tableLabel: true } },
        actor: { select: { name: true } },
      },
    }),
    db.serviceRequest.count({
      where: { tenantId, branchId: { in: branchIds }, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    }),
    db.menuItem.count({ where: { tenantId, isArchived: false, isAvailable: false } }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])) as Record<string, number>;
  const total = byStatus.reduce((a, s) => a + s._count._all, 0);
  const branchNames = new Map(
    (await db.branch.findMany({ where: { tenantId, id: { in: branchIds } }, select: { id: true, name: true } })).map(
      (b) => [b.id, b.name],
    ),
  );
  const daily = f.range === "today" ? [] : await dailySeries(tenantId, branchIds, from, ctx.tenant.timezone);

  return {
    range: f.range,
    from,
    currency: ctx.tenant.currency,
    orders: {
      total,
      active: ["PLACED", "ACKNOWLEDGED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "SERVED"].reduce(
        (a, s) => a + (statusCounts[s] ?? 0),
        0,
      ),
      completed: statusCounts.COMPLETED ?? 0,
      cancelled: statusCounts.CANCELLED ?? 0,
      byStatus: statusCounts,
    },
    money: {
      orderValueMinor: valueAgg._sum.totalMinor ?? 0,
      paidOnTheseOrdersMinor: valueAgg._sum.amountPaidMinor ?? 0,
      outstandingMinor: (valueAgg._sum.totalMinor ?? 0) - (valueAgg._sum.amountPaidMinor ?? 0),
      averageOrderMinor: Math.round(valueAgg._avg.totalMinor ?? 0),
      collectedMinor: collectedAgg._sum.amountMinor ?? 0,
      paymentsCount: collectedAgg._count._all,
      taxAddedMinor: valueAgg._sum.taxMinor ?? 0,
      taxIncludedMinor: valueAgg._sum.taxIncludedMinor ?? 0,
      serviceChargeMinor: valueAgg._sum.serviceChargeMinor ?? 0,
      byMethod: byMethod.map((m) => ({ method: m.method, amountMinor: m._sum.amountMinor ?? 0 })),
    },
    popular: popular.map((p) => ({
      name: p.nameSnapshot,
      quantity: p._sum.quantity ?? 0,
      valueMinor: p._sum.lineTotalMinor ?? 0,
    })),
    branches: branches
      .map((b) => ({
        id: b.branchId,
        name: branchNames.get(b.branchId) ?? "—",
        orders: b._count._all,
        valueMinor: b._sum.totalMinor ?? 0,
      }))
      .sort((a, b) => b.valueMinor - a.valueMinor),
    kitchen: { waitingTickets, delayedTickets, delayMinutes: settings?.kitchenDelayWarningMinutes ?? 15 },
    openRequests,
    unavailableItems: unavailable,
    daily,
    recent: recent.map((r) => ({
      id: r.id,
      at: r.createdAt,
      orderId: r.order.id,
      reference: r.order.reference,
      tableLabel: r.order.tableLabel,
      from: r.fromStatus,
      to: r.toStatus,
      actor: r.actor?.name ?? (r.actorType === "CUSTOMER" ? "Customer" : "System"),
    })),
  };
}
export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;

async function dailySeries(tenantId: string, branchIds: string[], from: Date, timeZone: string) {
  if (branchIds.length === 0) return [];
  const rows = await db.$queryRaw<{ day: string; orders: bigint; value: bigint | null }[]>`
    SELECT to_char(("placedAt" AT TIME ZONE 'UTC') AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS day,
           COUNT(*) AS orders,
           SUM("totalMinor") AS value
    FROM "Order"
    WHERE "tenantId" = ${tenantId}
      AND "branchId" IN (${Prisma.join(branchIds)})
      AND "placedAt" >= ${from}
      AND "status" <> 'CANCELLED'
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => ({ day: r.day, orders: Number(r.orders), valueMinor: Number(r.value ?? 0) }));
}

// ───────────── Audit ─────────────

export async function getTenantAudit(ctx: TenantContext, take = 100) {
  requirePermission(ctx, "tenant.audit.view");
  return db.auditLog.findMany({
    where: { tenantId: ctx.tenant.id },
    orderBy: { createdAt: "desc" },
    take: Math.min(take, 500),
    include: { actor: { select: { name: true, email: true, platformRole: true } } },
  });
}

export async function getPlatformAudit(
  user: SessionUser | null,
  input: { tenantId?: string | null; action?: string | null } = {},
) {
  requirePlatform(user, "platform.audit.view");
  return db.auditLog.findMany({
    where: {
      tenantId: input.tenantId || undefined,
      action: input.action ? { startsWith: input.action } : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { actor: { select: { name: true, email: true } }, tenant: { select: { name: true, slug: true } } },
  });
}

/** Tenant data export (orders with items and payments) as CSV rows — available even when suspended. */
export async function exportOrdersCsv(ctx: TenantContext, from: Date, to: Date): Promise<string> {
  requirePermission(ctx, "reports.view");
  const branchIds = branchesWith(ctx, "reports.view");
  const orders = await db.order.findMany({
    where: { tenantId: ctx.tenant.id, branchId: { in: branchIds }, placedAt: { gte: from, lt: to } },
    orderBy: { placedAt: "asc" },
    include: { branch: { select: { name: true } }, items: true },
    take: 50_000,
  });
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    // Prevent CSV formula injection in spreadsheet apps.
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = [
    "reference",
    "placed_at_utc",
    "branch",
    "table",
    "status",
    "payment_status",
    "items",
    "subtotal_minor",
    "service_charge_minor",
    "tax_minor",
    "total_minor",
    "paid_minor",
    "currency",
  ];
  const lines = [header.join(",")];
  for (const o of orders) {
    lines.push(
      [
        o.reference,
        o.placedAt.toISOString(),
        o.branch.name,
        o.tableLabel,
        o.status,
        o.paymentStatus,
        o.items
          .map((i) => `${i.quantity}x ${i.nameSnapshot}${i.variantNameSnapshot ? ` (${i.variantNameSnapshot})` : ""}`)
          .join("; "),
        o.subtotalMinor,
        o.serviceChargeMinor,
        o.taxMinor,
        o.totalMinor,
        o.amountPaidMinor,
        o.currency,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n");
}
