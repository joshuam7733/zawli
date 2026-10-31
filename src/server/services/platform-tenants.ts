// Platform administration: tenant onboarding and lifecycle.
import { z } from "zod";
import { FulfillmentMode, SubscriptionStatus, TenantStatus } from "@/generated/prisma/enums";
import { db } from "../db";
import { requirePlatform, type SessionUser } from "../authz";
import { AppError, conflict, isUniqueViolation, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import { emailSchema, findOrCreateUserForInvite, issueSetupToken, personNameSchema, setupUrl } from "./accounts";
import {
  checkbox,
  countrySchema,
  currencySchema,
  hexColorSchema,
  idSchema,
  localeSchema,
  optionalText,
  percentBpsSchema,
  phoneSchema,
  slugSchema,
  timezoneSchema,
} from "../validation";

export const createTenantSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  legalName: optionalText(120),
  contactEmail: emailSchema
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  contactPhone: phoneSchema,
  addressLine: optionalText(160),
  city: optionalText(80),
  country: countrySchema.default("UG"),
  currency: currencySchema.default("UGX"),
  timezone: timezoneSchema.default("Africa/Kampala"),
  locale: localeSchema.default("en-UG"),
  brandPrimary: hexColorSchema.default("#14532D"),
  brandAccent: hexColorSchema.default("#A3E635"),
  branchName: z.string().trim().min(2).max(80),
  fulfillmentMode: z.enum(FulfillmentMode).default("DIGITAL_DISPLAY"),
  ownerName: personNameSchema,
  ownerEmail: emailSchema,
  planId: idSchema,
  subscriptionStatus: z.enum(["TRIAL", "ACTIVE"]).default("TRIAL"),
  trialDays: z.coerce.number().int().min(0).max(90).default(14),
  enableWaiterCalls: checkbox.default(true),
  enableBillRequests: checkbox.default(true),
  taxEnabled: checkbox.default(false),
  taxRatePercent: percentBpsSchema.default(0),
  taxInclusive: checkbox.default(true),
  serviceChargeEnabled: checkbox.default(false),
  serviceChargePercent: percentBpsSchema.default(0),
  isDemo: checkbox.default(false),
});
export type CreateTenantInput = z.input<typeof createTenantSchema>;

export async function createTenant(user: SessionUser | null, input: CreateTenantInput) {
  const ctx = requirePlatform(user, "platform.tenants.manage");
  const data = createTenantSchema.parse(input);
  if (data.taxEnabled && data.taxRatePercent === 0) throw validation("Enter a tax rate or turn tax off.");
  if (data.serviceChargeEnabled && data.serviceChargePercent === 0)
    throw validation("Enter a service charge rate or turn the service charge off.");

  const plan = await db.subscriptionPlan.findUnique({ where: { id: data.planId } });
  if (!plan || !plan.isActive) throw validation("Choose an active subscription plan.");

  try {
    return await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.name,
          slug: data.slug,
          legalName: data.legalName,
          contactEmail: data.contactEmail ?? null,
          contactPhone: data.contactPhone,
          addressLine: data.addressLine,
          city: data.city,
          country: data.country,
          currency: data.currency,
          timezone: data.timezone,
          locale: data.locale,
          brandPrimary: data.brandPrimary,
          brandAccent: data.brandAccent,
          isDemo: data.isDemo,
          status: "ONBOARDING",
          settings: {
            create: {
              enableWaiterCalls: data.enableWaiterCalls,
              enableBillRequests: data.enableBillRequests,
              taxEnabled: data.taxEnabled,
              taxRateBps: data.taxRatePercent,
              taxInclusive: data.taxInclusive,
              serviceChargeEnabled: data.serviceChargeEnabled,
              serviceChargeBps: data.serviceChargePercent,
            },
          },
        },
      });
      const branch = await tx.branch.create({
        data: { tenantId: tenant.id, name: data.branchName, slug: "main", fulfillmentMode: data.fulfillmentMode },
      });
      await tx.kitchenStation.create({
        data: { tenantId: tenant.id, branchId: branch.id, name: "Kitchen", isDefault: true },
      });

      const owner = await findOrCreateUserForInvite(tx, {
        email: data.ownerEmail,
        name: data.ownerName,
        createdById: ctx.user.id,
      });
      await tx.membership.create({
        data: { tenantId: tenant.id, userId: owner.userId, role: "RESTAURANT_OWNER", allBranches: true },
      });

      const now = new Date();
      const trialEndsAt =
        data.subscriptionStatus === "TRIAL" ? new Date(now.getTime() + data.trialDays * 86_400_000) : null;
      const sub = await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: data.subscriptionStatus,
          trialEndsAt,
          currentPeriodStart: now,
        },
      });
      await tx.subscriptionEvent.create({
        data: {
          tenantId: tenant.id,
          subscriptionId: sub.id,
          toStatus: data.subscriptionStatus,
          actorId: ctx.user.id,
          reason: "Tenant created",
        },
      });
      await writeAudit(tx, {
        tenantId: tenant.id,
        actorId: ctx.user.id,
        action: "tenant.created",
        entityType: "Tenant",
        entityId: tenant.id,
        metadata: { slug: tenant.slug, plan: plan.code, ownerEmail: data.ownerEmail },
      });
      return {
        tenantId: tenant.id,
        slug: tenant.slug,
        ownerSetupUrl: owner.setupToken ? setupUrl(owner.setupToken) : null,
        ownerExisted: !owner.isNew,
      };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A restaurant with this slug already exists.");
    throw e;
  }
}

export const updateTenantSchema = createTenantSchema
  .pick({
    name: true,
    legalName: true,
    contactEmail: true,
    contactPhone: true,
    addressLine: true,
    city: true,
    country: true,
    currency: true,
    timezone: true,
    locale: true,
    brandPrimary: true,
    brandAccent: true,
  })
  .extend({ tenantId: idSchema });

export async function updateTenantProfile(user: SessionUser | null, input: z.input<typeof updateTenantSchema>) {
  const ctx = requirePlatform(user, "platform.tenants.manage");
  const data = updateTenantSchema.parse(input);
  const { tenantId, ...fields } = data;
  return db.$transaction(async (tx) => {
    const existing = await tx.tenant.findUnique({ where: { id: tenantId } });
    if (!existing) throw notFound("Restaurant");
    if (existing.currency !== fields.currency) {
      const hasOrders = await tx.order.count({ where: { tenantId } });
      if (hasOrders > 0) throw validation("Currency cannot change after orders exist.");
    }
    await tx.tenant.update({ where: { id: tenantId }, data: { ...fields, contactEmail: fields.contactEmail ?? null } });
    await writeAudit(tx, {
      tenantId,
      actorId: ctx.user.id,
      action: "tenant.updated",
      entityType: "Tenant",
      entityId: tenantId,
    });
  });
}

export interface ReadinessItem {
  key: string;
  label: string;
  done: boolean;
}

/** Onboarding checklist. A tenant cannot go ACTIVE (public ordering) until all items are done. */
export async function getTenantReadiness(tenantId: string): Promise<ReadinessItem[]> {
  const [branches, owners, tables, items, sub, stations] = await Promise.all([
    db.branch.count({ where: { tenantId, isActive: true } }),
    db.membership.count({ where: { tenantId, role: "RESTAURANT_OWNER", isActive: true } }),
    db.tableQrToken.count({ where: { tenantId, status: "ACTIVE", table: { isActive: true } } }),
    db.menuItem.count({ where: { tenantId, isArchived: false, isAvailable: true, category: { isArchived: false } } }),
    db.subscription.findUnique({ where: { tenantId } }),
    db.kitchenStation.count({ where: { tenantId, isActive: true, isDefault: true } }),
  ]);
  const ownerWithPassword = await db.membership.count({
    where: {
      tenantId,
      role: "RESTAURANT_OWNER",
      isActive: true,
      user: { accounts: { some: { providerId: "credential", password: { not: null } } } },
    },
  });
  return [
    { key: "branch", label: "At least one active branch", done: branches > 0 },
    { key: "station", label: "A default kitchen station", done: stations > 0 },
    { key: "owner", label: "Owner account assigned", done: owners > 0 },
    { key: "ownerLogin", label: "Owner has completed account setup", done: ownerWithPassword > 0 },
    { key: "menu", label: "At least one available menu item", done: items > 0 },
    { key: "tables", label: "At least one table with a QR code", done: tables > 0 },
    {
      key: "subscription",
      label: "Subscription in good standing",
      done: !!sub && (sub.status === "TRIAL" || sub.status === "ACTIVE" || sub.status === "PAST_DUE"),
    },
  ];
}

export const setTenantStatusSchema = z.object({
  tenantId: idSchema,
  status: z.enum(TenantStatus),
  reason: optionalText(300),
});

/**
 * Lifecycle: ONBOARDING → ACTIVE (readiness required) → SUSPENDED ⇄ ACTIVE → DEACTIVATED.
 * Data is never deleted by these transitions.
 */
export async function setTenantStatus(user: SessionUser | null, input: z.input<typeof setTenantStatusSchema>) {
  const ctx = requirePlatform(user, "platform.tenants.manage");
  const data = setTenantStatusSchema.parse(input);
  const tenant = await db.tenant.findUnique({ where: { id: data.tenantId } });
  if (!tenant) throw notFound("Restaurant");
  if (tenant.status === data.status) return;

  const allowed: Record<TenantStatus, TenantStatus[]> = {
    ONBOARDING: ["ACTIVE", "DEACTIVATED"],
    ACTIVE: ["SUSPENDED", "DEACTIVATED"],
    SUSPENDED: ["ACTIVE", "DEACTIVATED"],
    DEACTIVATED: ["SUSPENDED"],
  };
  if (!allowed[tenant.status].includes(data.status)) {
    throw validation(`A ${tenant.status.toLowerCase()} restaurant cannot be moved to ${data.status.toLowerCase()}.`);
  }
  if ((data.status === "SUSPENDED" || data.status === "DEACTIVATED") && !data.reason) {
    throw validation("Give a reason for suspending or deactivating this restaurant.");
  }
  if (data.status === "ACTIVE") {
    const readiness = await getTenantReadiness(tenant.id);
    const missing = readiness.filter((r) => !r.done);
    if (missing.length > 0) {
      throw new AppError("VALIDATION", `Not ready to go live: ${missing.map((m) => m.label).join("; ")}.`, missing);
    }
  }

  await db.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: tenant.id },
      data: {
        status: data.status,
        onboardingCompletedAt: data.status === "ACTIVE" && !tenant.onboardingCompletedAt ? new Date() : undefined,
        suspendedAt: data.status === "SUSPENDED" ? new Date() : data.status === "ACTIVE" ? null : undefined,
        suspensionReason: data.status === "ACTIVE" ? null : (data.reason ?? undefined),
      },
    });
    await writeAudit(tx, {
      tenantId: tenant.id,
      actorId: ctx.user.id,
      action: `tenant.status.${data.status.toLowerCase()}`,
      entityType: "Tenant",
      entityId: tenant.id,
      metadata: { from: tenant.status, to: data.status, reason: data.reason },
    });
  });
}

/** Issues a fresh one-time setup link for a tenant owner (e.g. lost first-login email). */
export async function reissueOwnerSetupLink(user: SessionUser | null, input: { tenantId: string; userId: string }) {
  const ctx = requirePlatform(user, "platform.tenants.manage");
  const membership = await db.membership.findFirst({
    where: { tenantId: input.tenantId, userId: input.userId, role: "RESTAURANT_OWNER" },
  });
  if (!membership) throw notFound("Owner");
  return db.$transaction(async (tx) => {
    const token = await issueSetupToken(tx, input.userId, ctx.user.id);
    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorId: ctx.user.id,
      action: "owner.setup_link_issued",
      entityType: "User",
      entityId: input.userId,
    });
    return setupUrl(token);
  });
}

export const listTenantsSchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum(TenantStatus).optional(),
  subscription: z.enum(SubscriptionStatus).optional(),
});

export async function listTenants(user: SessionUser | null, input: z.input<typeof listTenantsSchema> = {}) {
  requirePlatform(user, "platform.tenants.view");
  const f = listTenantsSchema.parse(input);
  return db.tenant.findMany({
    where: {
      status: f.status,
      subscription: f.subscription ? { status: f.subscription } : undefined,
      OR: f.q
        ? [
            { name: { contains: f.q, mode: "insensitive" } },
            { slug: { contains: f.q, mode: "insensitive" } },
            { city: { contains: f.q, mode: "insensitive" } },
          ]
        : undefined,
    },
    orderBy: { createdAt: "desc" },
    include: {
      subscription: { include: { plan: true } },
      _count: { select: { branches: true, memberships: true } },
    },
  });
}

export async function getPlatformOverview(user: SessionUser | null) {
  requirePlatform(user, "platform.tenants.view");
  const since = new Date(Date.now() - 24 * 3600_000);
  const [byStatus, bySub, orders24h, overdueInvoices, openInvoices] = await Promise.all([
    db.tenant.groupBy({ by: ["status"], _count: { _all: true } }),
    db.subscription.groupBy({ by: ["status"], _count: { _all: true } }),
    db.order.count({ where: { placedAt: { gte: since } } }),
    db.invoice.count({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] }, dueDate: { lt: new Date() } } }),
    db.invoice.count({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID"] } } }),
  ]);
  return {
    tenantsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r._count._all])) as Partial<
      Record<TenantStatus, number>
    >,
    subscriptionsByStatus: Object.fromEntries(bySub.map((r) => [r.status, r._count._all])) as Partial<
      Record<SubscriptionStatus, number>
    >,
    orders24h,
    overdueInvoices,
    openInvoices,
  };
}
