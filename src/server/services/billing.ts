// Platform → restaurant SaaS billing. MANUAL in V1: plans, subscription status,
// invoices and received payments are maintained by platform staff. Kept entirely
// separate from restaurant customer orders/payments. A future gateway plugs in by
// creating InvoicePayment rows and calling the same status logic.
import { z } from "zod";
import { BillingInterval, PaymentMethod, SubscriptionStatus } from "@/generated/prisma/enums";
import {
  canTransitionSubscription,
  computeInvoiceTotals,
  formatInvoiceNumber,
  invoiceStatusAfterPayment,
  isInvoiceOverdue,
  tenantStatusForSubscription,
} from "@/domain/billing";
import { db, type Tx } from "../db";
import { requirePermission, requirePlatform, type SessionUser, type TenantContext } from "../authz";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import { nextCounterValue } from "../counters";
import { currencySchema, idSchema, minorAmountSchema, optionalText } from "../validation";

// ───────────── Plans ─────────────

export async function listPlans(user: SessionUser | null) {
  requirePlatform(user, "platform.tenants.view");
  return db.subscriptionPlan.findMany({
    orderBy: [{ isActive: "desc" }, { priceMinor: "asc" }],
    include: { _count: { select: { subscriptions: true } } },
  });
}

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,30}$/, "Use lowercase letters, numbers and hyphens."),
  name: z.string().trim().min(2).max(60),
  description: optionalText(300),
  priceMinor: minorAmountSchema,
  currency: currencySchema,
  billingInterval: z.enum(BillingInterval),
  maxBranches: z.coerce.number().int().min(1).max(1000).optional().nullable(),
  isActive: z.boolean().default(true),
});

export async function savePlan(
  user: SessionUser | null,
  input: z.input<typeof planSchema> & { planId?: string | null },
) {
  const ctx = requirePlatform(user, "platform.plans.manage");
  const data = planSchema.parse(input);
  try {
    return await db.$transaction(async (tx) => {
      const plan = input.planId
        ? await tx.subscriptionPlan.update({
            where: { id: idSchema.parse(input.planId) },
            data: { ...data, maxBranches: data.maxBranches ?? null },
          })
        : await tx.subscriptionPlan.create({ data: { ...data, maxBranches: data.maxBranches ?? null } });
      await writeAudit(tx, {
        actorId: ctx.user.id,
        action: input.planId ? "plan.updated" : "plan.created",
        entityType: "SubscriptionPlan",
        entityId: plan.id,
        metadata: { code: plan.code, priceMinor: plan.priceMinor, currency: plan.currency },
      });
      return plan;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A plan with this code already exists.");
    throw e;
  }
}

// ───────────── Subscriptions ─────────────

export const changeSubscriptionSchema = z.object({
  tenantId: idSchema,
  status: z.enum(SubscriptionStatus).optional(),
  planId: idSchema.optional().nullable(),
  currentPeriodEnd: z.coerce.date().optional().nullable(),
  reason: z.string().trim().min(3, "Give a reason for this change.").max(300),
});

async function applySubscriptionStatus(
  tx: Tx,
  sub: { id: string; tenantId: string; status: SubscriptionStatus },
  to: SubscriptionStatus,
  actorId: string | null,
  reason: string,
) {
  if (!canTransitionSubscription(sub.status, to)) {
    throw validation(`A ${sub.status.toLowerCase()} subscription cannot become ${to.toLowerCase()}.`);
  }
  await tx.subscription.update({
    where: { id: sub.id },
    data: { status: to, cancelledAt: to === "CANCELLED" ? new Date() : to === "ACTIVE" ? null : undefined },
  });
  await tx.subscriptionEvent.create({
    data: { tenantId: sub.tenantId, subscriptionId: sub.id, fromStatus: sub.status, toStatus: to, actorId, reason },
  });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: sub.tenantId } });
  const nextTenant = tenantStatusForSubscription(to, tenant.status);
  if (nextTenant) {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: nextTenant,
        suspendedAt: nextTenant === "SUSPENDED" ? new Date() : null,
        suspensionReason: nextTenant === "SUSPENDED" ? `Subscription ${to.toLowerCase()}: ${reason}` : null,
      },
    });
    await writeAudit(tx, {
      tenantId: tenant.id,
      actorId,
      action: `tenant.status.${nextTenant.toLowerCase()}`,
      entityType: "Tenant",
      entityId: tenant.id,
      metadata: { from: tenant.status, to: nextTenant, cause: `subscription.${to.toLowerCase()}` },
    });
  }
}

export async function changeSubscription(user: SessionUser | null, input: z.input<typeof changeSubscriptionSchema>) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const data = changeSubscriptionSchema.parse(input);
  const sub = await db.subscription.findUnique({ where: { tenantId: data.tenantId } });
  if (!sub) throw notFound("Subscription");
  await db.$transaction(async (tx) => {
    if (data.planId && data.planId !== sub.planId) {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: data.planId } });
      if (!plan || !plan.isActive) throw validation("Choose an active plan.");
      await tx.subscription.update({ where: { id: sub.id }, data: { planId: plan.id } });
    }
    if (data.currentPeriodEnd) {
      await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: data.currentPeriodEnd } });
    }
    if (data.status && data.status !== sub.status) {
      await applySubscriptionStatus(tx, sub, data.status, ctx.user.id, data.reason);
    }
    await writeAudit(tx, {
      tenantId: sub.tenantId,
      actorId: ctx.user.id,
      action: "subscription.changed",
      entityType: "Subscription",
      entityId: sub.id,
      metadata: { status: data.status, planId: data.planId, reason: data.reason },
    });
  });
}

// ───────────── Invoices ─────────────

export const createInvoiceSchema = z
  .object({
    tenantId: idSchema,
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    dueDate: z.coerce.date(),
    lines: z
      .array(
        z.object({
          description: z.string().trim().min(2).max(160),
          quantity: z.coerce.number().int().min(1).max(1000),
          unitPriceMinor: minorAmountSchema,
        }),
      )
      .min(1, "Add at least one line.")
      .max(30),
    taxMinor: minorAmountSchema.default(0),
    notes: optionalText(500),
    issue: z.boolean().default(false),
  })
  .refine((v) => v.periodEnd >= v.periodStart, { message: "The period end is before its start.", path: ["periodEnd"] });

export async function createInvoice(user: SessionUser | null, input: z.input<typeof createInvoiceSchema>) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const data = createInvoiceSchema.parse(input);
  const tenant = await db.tenant.findUnique({
    where: { id: data.tenantId },
    include: { subscription: { include: { plan: true } } },
  });
  if (!tenant) throw notFound("Restaurant");
  const totals = computeInvoiceTotals(data.lines, data.taxMinor);
  const currency = tenant.subscription?.plan.currency ?? tenant.currency;
  return db.$transaction(async (tx) => {
    const now = new Date();
    const year = now.getUTCFullYear();
    const seq = await nextCounterValue(tx, `invoice:${year}`);
    const invoice = await tx.invoice.create({
      data: {
        tenantId: tenant.id,
        subscriptionId: tenant.subscription?.id ?? null,
        number: formatInvoiceNumber(year, seq),
        status: data.issue ? "ISSUED" : "DRAFT",
        currency,
        periodStart: data.periodStart,
        periodEnd: data.periodEnd,
        issueDate: data.issue ? now : null,
        dueDate: data.dueDate,
        subtotalMinor: totals.subtotalMinor,
        taxMinor: totals.taxMinor,
        totalMinor: totals.totalMinor,
        notes: data.notes,
        createdById: ctx.user.id,
        lines: {
          create: data.lines.map((l, i) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceMinor: l.unitPriceMinor,
            amountMinor: totals.amounts[i],
            sortOrder: i,
          })),
        },
      },
    });
    await writeAudit(tx, {
      tenantId: tenant.id,
      actorId: ctx.user.id,
      action: data.issue ? "invoice.issued" : "invoice.created",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { number: invoice.number, totalMinor: invoice.totalMinor, currency },
    });
    if (data.issue) await notifyInvoice(tx, tenant.id, invoice.number, invoice.id);
    return invoice;
  });
}

async function notifyInvoice(tx: Tx, tenantId: string, number: string, invoiceId: string) {
  await tx.notification.create({
    data: {
      tenantId,
      type: "invoice.issued",
      title: `Invoice ${number} issued`,
      entityType: "Invoice",
      entityId: invoiceId,
    },
  });
}

export async function issueInvoice(user: SessionUser | null, input: { invoiceId: string }) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const inv = await db.invoice.findUnique({ where: { id: idSchema.parse(input.invoiceId) } });
  if (!inv) throw notFound("Invoice");
  if (inv.status !== "DRAFT") throw validation("Only draft invoices can be issued.");
  await db.$transaction(async (tx) => {
    await tx.invoice.update({ where: { id: inv.id }, data: { status: "ISSUED", issueDate: new Date() } });
    await writeAudit(tx, {
      tenantId: inv.tenantId,
      actorId: ctx.user.id,
      action: "invoice.issued",
      entityType: "Invoice",
      entityId: inv.id,
      metadata: { number: inv.number },
    });
    await notifyInvoice(tx, inv.tenantId, inv.number, inv.id);
  });
}

export async function voidInvoice(user: SessionUser | null, input: { invoiceId: string; reason: string }) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const reason = z.string().trim().min(3, "Give a reason.").max(300).parse(input.reason);
  const inv = await db.invoice.findUnique({ where: { id: idSchema.parse(input.invoiceId) } });
  if (!inv) throw notFound("Invoice");
  if (inv.status === "VOID") return;
  if (inv.amountPaidMinor > 0) throw validation("This invoice has recorded payments and cannot be voided.");
  await db.$transaction(async (tx) => {
    await tx.invoice.update({
      where: { id: inv.id },
      data: { status: "VOID", voidedAt: new Date(), voidReason: reason },
    });
    await writeAudit(tx, {
      tenantId: inv.tenantId,
      actorId: ctx.user.id,
      action: "invoice.voided",
      entityType: "Invoice",
      entityId: inv.id,
      metadata: { number: inv.number, reason },
    });
  });
}

export const invoicePaymentSchema = z.object({
  invoiceId: idSchema,
  amountMinor: z.coerce.number().int().positive("Enter an amount greater than zero."),
  method: z.enum(PaymentMethod),
  reference: optionalText(80),
  receivedAt: z.coerce.date(),
  note: optionalText(200),
});

/** Records a manually received subscription payment. PAST_DUE subscriptions return to ACTIVE when nothing is overdue. */
export async function recordInvoicePayment(user: SessionUser | null, input: z.input<typeof invoicePaymentSchema>) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const data = invoicePaymentSchema.parse(input);
  if (data.receivedAt.getTime() > Date.now() + 86_400_000) throw validation("The received date is in the future.");
  await db.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: data.invoiceId } });
    if (!inv) throw notFound("Invoice");
    let next;
    try {
      next = invoiceStatusAfterPayment(inv.status, inv.totalMinor, inv.amountPaidMinor, data.amountMinor);
    } catch (e) {
      throw validation(e instanceof Error ? e.message : "Invalid payment.");
    }
    const res = await tx.invoice.updateMany({
      where: { id: inv.id, amountPaidMinor: inv.amountPaidMinor },
      data: {
        amountPaidMinor: next.amountPaidMinor,
        status: next.status,
        paidAt: next.status === "PAID" ? new Date() : null,
      },
    });
    if (res.count !== 1) throw conflict("This invoice was just updated. Refresh and try again.");
    await tx.invoicePayment.create({
      data: {
        tenantId: inv.tenantId,
        invoiceId: inv.id,
        amountMinor: data.amountMinor,
        method: data.method,
        reference: data.reference,
        receivedAt: data.receivedAt,
        note: data.note,
        recordedById: ctx.user.id,
      },
    });
    await writeAudit(tx, {
      tenantId: inv.tenantId,
      actorId: ctx.user.id,
      action: "invoice.payment_recorded",
      entityType: "Invoice",
      entityId: inv.id,
      metadata: { number: inv.number, amountMinor: data.amountMinor, method: data.method },
    });
    if (next.status === "PAID") {
      const sub = await tx.subscription.findUnique({ where: { tenantId: inv.tenantId } });
      const stillOverdue = await tx.invoice.count({
        where: { tenantId: inv.tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } },
      });
      if (sub && sub.status === "PAST_DUE" && stillOverdue === 0) {
        await applySubscriptionStatus(tx, sub, "ACTIVE", ctx.user.id, `Invoice ${inv.number} paid`);
      }
    }
  });
}

export const listInvoicesSchema = z.object({
  tenantId: idSchema.optional().nullable(),
  filter: z.enum(["all", "open", "overdue", "paid", "draft"]).default("all"),
});

export async function listInvoices(user: SessionUser | null, input: z.input<typeof listInvoicesSchema> = {}) {
  requirePlatform(user, "platform.billing.view");
  const f = listInvoicesSchema.parse(input);
  const now = new Date();
  const where = {
    tenantId: f.tenantId ?? undefined,
    ...(f.filter === "open" ? { status: { in: ["ISSUED", "PARTIALLY_PAID"] as ("ISSUED" | "PARTIALLY_PAID")[] } } : {}),
    ...(f.filter === "overdue"
      ? { status: { in: ["ISSUED", "PARTIALLY_PAID"] as ("ISSUED" | "PARTIALLY_PAID")[] }, dueDate: { lt: now } }
      : {}),
    ...(f.filter === "paid" ? { status: "PAID" as const } : {}),
    ...(f.filter === "draft" ? { status: "DRAFT" as const } : {}),
  };
  const invoices = await db.invoice.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { tenant: { select: { name: true, slug: true } } },
  });
  return invoices.map((i) => ({ ...i, overdue: isInvoiceOverdue(i, now) }));
}

export async function getInvoice(user: SessionUser | null, invoiceId: string) {
  requirePlatform(user, "platform.billing.view");
  const inv = await db.invoice.findUnique({
    where: { id: idSchema.parse(invoiceId) },
    include: {
      tenant: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "asc" }, include: { recordedBy: { select: { name: true } } } },
      subscription: { include: { plan: true } },
    },
  });
  if (!inv) throw notFound("Invoice");
  return { ...inv, overdue: isInvoiceOverdue(inv) };
}

/**
 * Daily billing sweep (run from the admin UI or a scheduler): ACTIVE/TRIAL
 * subscriptions with overdue invoices, or expired trials, become PAST_DUE.
 * Never suspends automatically — suspension is a deliberate human decision.
 */
export async function runBillingSweep(user: SessionUser | null) {
  const ctx = requirePlatform(user, "platform.billing.manage");
  const now = new Date();
  const subs = await db.subscription.findMany({ where: { status: { in: ["ACTIVE", "TRIAL"] } } });
  let changed = 0;
  for (const sub of subs) {
    const overdue = await db.invoice.count({
      where: { tenantId: sub.tenantId, status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: now } },
    });
    const trialExpired = sub.status === "TRIAL" && sub.trialEndsAt != null && sub.trialEndsAt < now;
    if (overdue > 0 || trialExpired) {
      await db.$transaction((tx) =>
        applySubscriptionStatus(tx, sub, "PAST_DUE", ctx.user.id, overdue > 0 ? "Invoice overdue" : "Trial ended"),
      );
      changed++;
    }
  }
  return { checked: subs.length, movedToPastDue: changed };
}

// ───────────── Tenant view ─────────────

export async function getTenantBilling(ctx: TenantContext) {
  requirePermission(ctx, "tenant.billing.view");
  const [subscription, invoices] = await Promise.all([
    db.subscription.findUnique({ where: { tenantId: ctx.tenant.id }, include: { plan: true } }),
    db.invoice.findMany({
      where: { tenantId: ctx.tenant.id, status: { not: "DRAFT" } },
      orderBy: { createdAt: "desc" },
      include: { lines: { orderBy: { sortOrder: "asc" } } },
    }),
  ]);
  return { subscription, invoices: invoices.map((i) => ({ ...i, overdue: isInvoiceOverdue(i) })) };
}

export async function getTenantInvoice(ctx: TenantContext, invoiceId: string) {
  requirePermission(ctx, "tenant.billing.view");
  const inv = await db.invoice.findFirst({
    where: { id: idSchema.parse(invoiceId), tenantId: ctx.tenant.id, status: { not: "DRAFT" } },
    include: {
      tenant: true,
      lines: { orderBy: { sortOrder: "asc" } },
      payments: { orderBy: { receivedAt: "asc" } },
      subscription: { include: { plan: true } },
    },
  });
  if (!inv) throw notFound("Invoice");
  return { ...inv, overdue: isInvoiceOverdue(inv) };
}
