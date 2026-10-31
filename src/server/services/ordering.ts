// Public (customer) side: QR resolution, menu, order placement, service requests.
// Customers are anonymous; the QR token is their only credential and every value
// that matters (prices, availability, totals) is recomputed here on the server.
import { z } from "zod";
import type { Tx } from "../db";
import { db } from "../db";
import { AppError, isUniqueViolation, notFound, validation } from "../errors";
import { isWellFormedToken, randomToken } from "../tokens";
import { nextCounterValue } from "../counters";
import { recordBranchEvent, signalBranch } from "../events";
import { describeLineError, resolveCartLine, type MenuItemSnapshot, type ResolvedLine } from "@/domain/cart";
import { computeOrderTotals } from "@/domain/pricing";
import { isTerminalOrderStatus } from "@/domain/order-status";
import type { MobileMoneyProvider } from "@/generated/prisma/enums";
import { getGuestPaymentState } from "./mobile-money";

// ───────────── QR resolution ─────────────

export interface ResolvedTable {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    currency: string;
    locale: string;
    timezone: string;
    logoUrl: string | null;
    brandPrimary: string;
    brandAccent: string;
    isDemo: boolean;
  };
  branch: { id: string; name: string; fulfillmentMode: string };
  table: { id: string; label: string };
  settings: {
    enableWaiterCalls: boolean;
    enableBillRequests: boolean;
    enableOrderTracking: boolean;
    allowItemNotes: boolean;
    maxItemQuantity: number;
    tableSessionIdleMinutes: number;
    taxEnabled: boolean;
    taxRateBps: number;
    taxInclusive: boolean;
    taxLabel: string;
    serviceChargeEnabled: boolean;
    serviceChargeBps: number;
    serviceChargeLabel: string;
    /** Orders must be paid by mobile money before the kitchen sees them. */
    payFirst: boolean;
    mobileMoneyProviders: MobileMoneyProvider[];
    unpaidOrderTimeoutMinutes: number;
  };
}

export type QrState = { ok: true; data: ResolvedTable } | { ok: false; reason: "invalid" | "closed" };

/**
 * Validates a QR token and its tenant → branch → table chain. Invalid, revoked,
 * or inactive → "invalid" (no detail leaks). Tenant not live → "closed".
 */
export async function resolveQr(token: string): Promise<QrState> {
  if (!isWellFormedToken(token)) return { ok: false, reason: "invalid" };
  const qr = await db.tableQrToken.findUnique({
    where: { token },
    include: {
      table: true,
      branch: true,
      tenant: { include: { settings: true, mobileMoney: { where: { isEnabled: true }, select: { provider: true } } } },
    },
  });
  if (!qr || qr.status !== "ACTIVE" || !qr.table.isActive || !qr.branch.isActive)
    return { ok: false, reason: "invalid" };
  // Defence in depth: the composite FKs already guarantee this chain.
  if (qr.table.tenantId !== qr.tenantId || qr.table.branchId !== qr.branchId || qr.branch.tenantId !== qr.tenantId)
    return { ok: false, reason: "invalid" };
  const t = qr.tenant;
  const s = t.settings;
  if (!s || t.status !== "ACTIVE") return { ok: false, reason: "closed" };
  return {
    ok: true,
    data: {
      tenant: {
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        currency: t.currency,
        locale: t.locale,
        timezone: qr.branch.timezone ?? t.timezone,
        logoUrl: t.logoUrl,
        brandPrimary: t.brandPrimary,
        brandAccent: t.brandAccent,
        isDemo: t.isDemo,
      },
      branch: { id: qr.branch.id, name: qr.branch.name, fulfillmentMode: qr.branch.fulfillmentMode },
      table: { id: qr.table.id, label: qr.table.label },
      settings: {
        enableWaiterCalls: s.enableWaiterCalls,
        enableBillRequests: s.enableBillRequests,
        enableOrderTracking: s.enableOrderTracking,
        allowItemNotes: s.allowItemNotes,
        maxItemQuantity: s.maxItemQuantity,
        tableSessionIdleMinutes: s.tableSessionIdleMinutes,
        taxEnabled: s.taxEnabled,
        taxRateBps: s.taxRateBps,
        taxInclusive: s.taxInclusive,
        taxLabel: s.taxLabel,
        serviceChargeEnabled: s.serviceChargeEnabled,
        serviceChargeBps: s.serviceChargeBps,
        serviceChargeLabel: s.serviceChargeLabel,
        ...payFirstSettings(s, t.mobileMoney),
      },
    },
  };
}

/** Pay-first applies when the restaurant chose it AND has at least one mobile money provider enabled. */
export function payFirstSettings(
  s: { paymentTiming: string; unpaidOrderTimeoutMinutes: number },
  enabled: { provider: MobileMoneyProvider }[],
) {
  const providers = [...new Set(enabled.map((m) => m.provider))].sort();
  return {
    payFirst: s.paymentTiming === "PAY_FIRST" && providers.length > 0,
    mobileMoneyProviders: providers,
    unpaidOrderTimeoutMinutes: s.unpaidOrderTimeoutMinutes,
  };
}

async function requireOpenQr(token: string): Promise<ResolvedTable> {
  const r = await resolveQr(token);
  if (!r.ok) {
    if (r.reason === "closed") throw new AppError("UNAVAILABLE", "This restaurant is not taking orders right now.");
    throw notFound("Table");
  }
  return r.data;
}

// ───────────── Menu ─────────────

interface SnapshotRow extends MenuItemSnapshot {
  categoryId: string;
  description: string | null;
  imageUrl: string | null;
  sortOrder: number;
}

/** Live menu for one branch as validation snapshots. Archived things are excluded. */
async function loadMenuSnapshots(client: Tx | typeof db, tenantId: string, branchId: string, itemIds?: string[]) {
  const items = await client.menuItem.findMany({
    where: {
      tenantId,
      isArchived: false,
      category: { isArchived: false },
      ...(itemIds ? { id: { in: itemIds } } : {}),
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: {
      category: { select: { name: true } },
      variants: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } },
      modifierGroups: {
        where: { modifierGroup: { isArchived: false } },
        orderBy: { sortOrder: "asc" },
        include: {
          modifierGroup: { include: { options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } } },
        },
      },
      branchSettings: { where: { branchId } },
    },
  });
  const map = new Map<string, SnapshotRow>();
  for (const it of items) {
    const override = it.branchSettings[0];
    if (override && !override.isOffered) continue; // not offered at this branch
    map.set(it.id, {
      id: it.id,
      categoryId: it.categoryId,
      name: it.name,
      description: it.description,
      imageUrl: it.imageUrl,
      sortOrder: it.sortOrder,
      categoryName: it.category.name,
      basePriceMinor: it.basePriceMinor,
      orderable: it.isAvailable && (override?.isAvailable ?? true),
      allergens: it.allergens,
      variants: it.variants.map((v) => ({
        id: v.id,
        name: v.name,
        priceMinor: v.priceMinor,
        isAvailable: v.isAvailable,
      })),
      groups: it.modifierGroups.map((g) => ({
        id: g.modifierGroup.id,
        name: g.modifierGroup.name,
        minSelect: g.modifierGroup.minSelect,
        maxSelect: g.modifierGroup.maxSelect,
        options: g.modifierGroup.options.map((o) => ({
          id: o.id,
          name: o.name,
          priceDeltaMinor: o.priceDeltaMinor,
          isAvailable: o.isAvailable,
        })),
      })),
    });
  }
  return map;
}

export async function getPublicMenu(tenantId: string, branchId: string) {
  const [categories, snapshots] = await Promise.all([
    db.menuCategory.findMany({
      where: { tenantId, isArchived: false },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, description: true },
    }),
    loadMenuSnapshots(db, tenantId, branchId),
  ]);
  const items = [...snapshots.values()];
  return categories
    .map((c) => ({
      ...c,
      items: items
        .filter((i) => i.categoryId === c.id)
        .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
        .map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description,
          imageUrl: i.imageUrl,
          basePriceMinor: i.basePriceMinor,
          orderable: i.orderable,
          allergens: i.allergens,
          variants: i.variants,
          groups: i.groups,
        })),
    }))
    .filter((c) => c.items.length > 0);
}
export type PublicMenu = Awaited<ReturnType<typeof getPublicMenu>>;

// ───────────── Table sessions ─────────────

/**
 * Returns the table's open session, creating one when there is none or the
 * current one has been idle longer than the tenant's limit (it is then EXPIRED).
 * Callers must hold the table row lock (lockTable) to avoid racing creators.
 */
export async function getOrOpenSession(tx: Tx, t: ResolvedTable, now = new Date()) {
  const open = await tx.tableSession.findFirst({
    where: { tenantId: t.tenant.id, tableId: t.table.id, status: "OPEN" },
  });
  if (open) {
    const idleMs = now.getTime() - open.lastActivityAt.getTime();
    if (idleMs <= t.settings.tableSessionIdleMinutes * 60_000) {
      return tx.tableSession.update({ where: { id: open.id }, data: { lastActivityAt: now } });
    }
    await tx.tableSession.update({
      where: { id: open.id },
      data: { status: "EXPIRED", closedAt: now, closeReason: "Idle timeout" },
    });
  }
  return tx.tableSession.create({
    data: { tenantId: t.tenant.id, branchId: t.branch.id, tableId: t.table.id, openedAt: now, lastActivityAt: now },
  });
}

async function lockTable(tx: Tx, tableId: string) {
  await tx.$queryRaw`SELECT id FROM "DiningTable" WHERE id = ${tableId} FOR UPDATE`;
}

// ───────────── Order placement ─────────────

export const placeOrderSchema = z.object({
  token: z.string().min(20).max(64),
  idempotencyKey: z.string().uuid("Invalid request key."),
  customerName: z
    .string()
    .trim()
    .max(40)
    .optional()
    .nullable()
    .transform((v) => v || null),
  customerNote: z
    .string()
    .trim()
    .max(300)
    .optional()
    .nullable()
    .transform((v) => v || null),
  lines: z
    .array(
      z.object({
        menuItemId: z.string().min(1).max(64),
        variantId: z.string().min(1).max(64).optional().nullable(),
        optionIds: z.array(z.string().min(1).max(64)).max(30).default([]),
        quantity: z.number().int(),
        note: z.string().max(280).optional().nullable(),
        // Any client-sent price is deliberately ignored (not part of the schema).
      }),
    )
    .min(1, "Your cart is empty.")
    .max(50, "Too many lines in one order."),
});
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

export interface PlacedOrder {
  reference: string;
  publicToken: string;
  totalMinor: number;
  currency: string;
  duplicate: boolean;
  /** Pay-first: the guest must pay by mobile money before the kitchen sees the order. */
  paymentRequired: boolean;
}

function routeStation(
  line: { menuItemId: string; categoryId: string },
  rules: { menuItemId: string | null; categoryId: string | null; stationId: string }[],
  defaultStationId: string,
) {
  return (
    rules.find((r) => r.menuItemId === line.menuItemId)?.stationId ??
    rules.find((r) => r.categoryId === line.categoryId)?.stationId ??
    defaultStationId
  );
}

export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const data = placeOrderSchema.parse(input);
  const t = await requireOpenQr(data.token);
  if (!t.settings.allowItemNotes) for (const l of data.lines) l.note = null;

  const existing = await db.order.findUnique({
    where: { tenantId_idempotencyKey: { tenantId: t.tenant.id, idempotencyKey: data.idempotencyKey } },
  });
  if (existing) {
    return {
      reference: existing.reference,
      publicToken: existing.publicToken,
      totalMinor: existing.totalMinor,
      currency: existing.currency,
      duplicate: true,
      paymentRequired: existing.status === "PENDING_PAYMENT",
    };
  }

  try {
    const result = await db.$transaction(
      async (tx) => {
        await lockTable(tx, t.table.id);

        const itemIds = [...new Set(data.lines.map((l) => l.menuItemId))];
        const menu = await loadMenuSnapshots(tx, t.tenant.id, t.branch.id, itemIds);
        const resolved: (ResolvedLine & { categoryId: string })[] = [];
        const errors: string[] = [];
        for (const line of data.lines) {
          const snap = menu.get(line.menuItemId);
          const r = resolveCartLine({ ...line, optionIds: line.optionIds ?? [] }, snap, t.settings.maxItemQuantity);
          if (r.ok) resolved.push({ ...r.line, categoryId: snap!.categoryId });
          else errors.push(describeLineError(r.error));
        }
        if (errors.length > 0) throw validation(errors[0], { errors: [...new Set(errors)] });

        const totals = computeOrderTotals(
          resolved.map((l) => l.lineTotalMinor),
          t.settings,
        );

        const stations = await tx.kitchenStation.findMany({
          where: { tenantId: t.tenant.id, branchId: t.branch.id, isActive: true },
        });
        const defaultStation = stations.find((s) => s.isDefault) ?? stations[0];
        if (!defaultStation) throw new AppError("UNAVAILABLE", "This restaurant is not taking orders right now.");
        const activeStationIds = new Set(stations.map((s) => s.id));
        const rules = (
          await tx.kitchenRoutingRule.findMany({ where: { tenantId: t.tenant.id, branchId: t.branch.id } })
        ).filter((r) => activeStationIds.has(r.stationId));

        const session = await getOrOpenSession(tx, t);
        const orderNumber = await nextCounterValue(tx, `order:${t.tenant.id}`);
        const reference = String(orderNumber).padStart(4, "0");
        // Pay-first: hold the order (no kitchen tickets, no printing) until mobile money payment is confirmed.
        const payFirst = t.settings.payFirst && totals.totalMinor > 0;

        const order = await tx.order.create({
          data: {
            tenantId: t.tenant.id,
            branchId: t.branch.id,
            tableId: t.table.id,
            tableSessionId: session.id,
            orderNumber,
            reference,
            publicToken: randomToken(24),
            idempotencyKey: data.idempotencyKey,
            currency: t.tenant.currency,
            ...totals,
            customerName: data.customerName,
            customerNote: data.customerNote,
            tableLabel: t.table.label,
            ...(payFirst
              ? {
                  status: "PENDING_PAYMENT" as const,
                  paymentDueBy: new Date(Date.now() + t.settings.unpaidOrderTimeoutMinutes * 60_000),
                }
              : { releasedAt: new Date() }),
          },
        });

        // One kitchen ticket per station that has items (created later, on payment, when pay-first).
        const stationFor = resolved.map((l) => routeStation(l, rules, defaultStation.id));
        const ticketByStation = new Map<string, string>();
        for (const stationId of payFirst ? [] : new Set(stationFor)) {
          const ticket = await tx.kitchenTicket.create({
            data: { tenantId: t.tenant.id, branchId: t.branch.id, orderId: order.id, stationId },
          });
          ticketByStation.set(stationId, ticket.id);
        }

        for (const [i, l] of resolved.entries()) {
          await tx.orderItem.create({
            data: {
              tenantId: t.tenant.id,
              orderId: order.id,
              menuItemId: l.menuItemId,
              variantId: l.variantId,
              stationId: stationFor[i],
              kitchenTicketId: ticketByStation.get(stationFor[i]),
              nameSnapshot: l.name,
              variantNameSnapshot: l.variantName,
              categoryNameSnapshot: l.categoryName,
              allergensSnapshot: l.allergens,
              unitPriceMinor: l.unitPriceMinor,
              modifiersUnitMinor: l.modifiersUnitMinor,
              quantity: l.quantity,
              lineTotalMinor: l.lineTotalMinor,
              note: l.note,
              sortOrder: i,
              // tenantId is inherited through the composite (tenantId, orderItemId) relation.
              modifiers: {
                create: l.modifiers.map((m) => ({
                  modifierOptionId: m.optionId,
                  groupNameSnapshot: m.groupName,
                  nameSnapshot: m.name,
                  priceDeltaMinor: m.priceDeltaMinor,
                })),
              },
            },
          });
        }

        await tx.orderStatusHistory.create({
          data: {
            tenantId: t.tenant.id,
            orderId: order.id,
            toStatus: payFirst ? "PENDING_PAYMENT" : "PLACED",
            actorType: "CUSTOMER",
          },
        });

        if (
          !payFirst &&
          (t.branch.fulfillmentMode === "PRINTER" || t.branch.fulfillmentMode === "DIGITAL_AND_PRINTER")
        ) {
          const printers = await tx.printerConfiguration.findMany({
            where: { tenantId: t.tenant.id, branchId: t.branch.id, isActive: true },
          });
          const jobs: { tenantId: string; branchId: string; ticketId: string; printerId: string }[] = [];
          for (const [stationId, ticketId] of ticketByStation)
            for (const p of printers)
              if (!p.stationId || p.stationId === stationId)
                jobs.push({ tenantId: t.tenant.id, branchId: t.branch.id, ticketId, printerId: p.id });
          if (jobs.length) await tx.printJob.createMany({ data: jobs, skipDuplicates: true });
        }

        await recordBranchEvent(tx, {
          tenantId: t.tenant.id,
          branchId: t.branch.id,
          type: "order.created",
          entityId: order.id,
        });
        return order;
      },
      { timeout: 15_000 },
    );
    signalBranch(t.branch.id);
    return {
      reference: result.reference,
      publicToken: result.publicToken,
      totalMinor: result.totalMinor,
      currency: result.currency,
      duplicate: false,
      paymentRequired: result.status === "PENDING_PAYMENT",
    };
  } catch (e) {
    // A concurrent duplicate submission won the race: return the order it created.
    if (isUniqueViolation(e)) {
      const dup = await db.order.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: t.tenant.id, idempotencyKey: data.idempotencyKey } },
      });
      if (dup)
        return {
          reference: dup.reference,
          publicToken: dup.publicToken,
          totalMinor: dup.totalMinor,
          currency: dup.currency,
          duplicate: true,
          paymentRequired: dup.status === "PENDING_PAYMENT",
        };
    }
    throw e;
  }
}

// ───────────── Order tracking ─────────────

export async function getPublicOrder(publicToken: string) {
  if (!isWellFormedToken(publicToken)) return null;
  const order = await db.order.findUnique({
    where: { publicToken },
    include: {
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: true } },
      tenant: {
        select: {
          name: true,
          currency: true,
          locale: true,
          timezone: true,
          logoUrl: true,
          brandPrimary: true,
          brandAccent: true,
          settings: { select: { enableOrderTracking: true, taxLabel: true, serviceChargeLabel: true } },
          mobileMoney: { where: { isEnabled: true }, select: { provider: true } },
        },
      },
      branch: { select: { name: true, timezone: true } },
    },
  });
  if (!order) return null;
  // Pay-first: refresh any pending mobile money payment (and expiry) before answering.
  const payment = order.status === "PENDING_PAYMENT" ? await getGuestPaymentState(order.id) : null;
  const current =
    order.status === "PENDING_PAYMENT"
      ? await db.order.findUniqueOrThrow({
          where: { id: order.id },
          select: { status: true, paymentStatus: true, paymentDueBy: true, cancelReason: true },
        })
      : order;
  return {
    reference: order.reference,
    status: current.status,
    paymentRequired: current.status === "PENDING_PAYMENT",
    paymentDueBy: current.status === "PENDING_PAYMENT" ? current.paymentDueBy : null,
    mobileMoneyProviders: order.tenant.mobileMoney.map((m) => m.provider).sort(),
    payment,
    paymentStatus: current.paymentStatus,
    tableLabel: order.tableLabel,
    placedAt: order.placedAt,
    readyAt: order.readyAt,
    servedAt: order.servedAt,
    cancelReason: current.status === "CANCELLED" ? current.cancelReason : null,
    currency: order.currency,
    subtotalMinor: order.subtotalMinor,
    serviceChargeMinor: order.serviceChargeMinor,
    taxMinor: order.taxMinor,
    taxIncludedMinor: order.taxIncludedMinor,
    totalMinor: order.totalMinor,
    isFinal: isTerminalOrderStatus(current.status),
    trackingEnabled: order.tenant.settings?.enableOrderTracking ?? true,
    taxLabel: order.tenant.settings?.taxLabel ?? "Tax",
    serviceChargeLabel: order.tenant.settings?.serviceChargeLabel ?? "Service charge",
    restaurant: {
      name: order.tenant.name,
      locale: order.tenant.locale,
      timezone: order.branch.timezone ?? order.tenant.timezone,
      branchName: order.branch.name,
      logoUrl: order.tenant.logoUrl,
      brandPrimary: order.tenant.brandPrimary,
      brandAccent: order.tenant.brandAccent,
    },
    items: order.items.map((i) => ({
      name: i.nameSnapshot,
      variant: i.variantNameSnapshot,
      quantity: i.quantity,
      lineTotalMinor: i.lineTotalMinor,
      note: i.note,
      modifiers: i.modifiers.map((m) => m.nameSnapshot),
    })),
  };
}
export type PublicOrder = NonNullable<Awaited<ReturnType<typeof getPublicOrder>>>;

// ───────────── Waiter calls & bill requests ─────────────

export const serviceRequestSchema = z.object({
  token: z.string().min(20).max(64),
  type: z.enum(["ASSISTANCE", "BILL"]),
  note: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .transform((v) => v || null),
});

/** Creates a waiter call / bill request. An identical open request is reused (no spam). */
export async function createServiceRequest(input: z.input<typeof serviceRequestSchema>) {
  const data = serviceRequestSchema.parse(input);
  const t = await requireOpenQr(data.token);
  if (data.type === "ASSISTANCE" && !t.settings.enableWaiterCalls)
    throw new AppError("UNAVAILABLE", "Calling a waiter from the table is not enabled here.");
  if (data.type === "BILL" && !t.settings.enableBillRequests)
    throw new AppError("UNAVAILABLE", "Requesting the bill from the table is not enabled here.");

  const result = await db.$transaction(async (tx) => {
    await lockTable(tx, t.table.id);
    const session = await getOrOpenSession(tx, t);
    const open = await tx.serviceRequest.findFirst({
      where: { tenantId: t.tenant.id, tableId: t.table.id, type: data.type, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
    });
    if (open) return { request: open, duplicate: true };
    const request = await tx.serviceRequest.create({
      data: {
        tenantId: t.tenant.id,
        branchId: t.branch.id,
        tableId: t.table.id,
        tableSessionId: session.id,
        type: data.type,
        note: data.note,
      },
    });
    await recordBranchEvent(tx, {
      tenantId: t.tenant.id,
      branchId: t.branch.id,
      type: "service.created",
      entityId: request.id,
    });
    return { request, duplicate: false };
  });
  if (!result.duplicate) signalBranch(t.branch.id);
  return { status: result.request.status, type: result.request.type, duplicate: result.duplicate };
}
