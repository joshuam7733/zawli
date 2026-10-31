// Restaurant-side configuration: profile, settings, branches, kitchen stations, routing.
import { z } from "zod";
import { FulfillmentMode } from "@/generated/prisma/enums";
import { db } from "../db";
import { requirePermission, requireWritable, type TenantContext } from "../authz";
import { conflict, isUniqueViolation, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import {
  checkbox,
  hexColorSchema,
  idSchema,
  optionalText,
  percentBpsSchema,
  phoneSchema,
  slugSchema,
  timezoneSchema,
} from "../validation";
import { emailSchema } from "./accounts";

export async function getRestaurantSettings(ctx: TenantContext) {
  requirePermission(ctx, "orders.view");
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: ctx.tenant.id },
    include: { settings: true },
  });
  return tenant;
}

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  contactEmail: emailSchema
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  contactPhone: phoneSchema,
  addressLine: optionalText(160),
  city: optionalText(80),
  brandPrimary: hexColorSchema,
  brandAccent: hexColorSchema,
  logoUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/uploads\/[A-Za-z0-9_\-/.]+$/)
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
});

/** Restaurant owners edit their own profile. Currency/timezone/slug are platform-managed. */
export async function updateRestaurantProfile(ctx: TenantContext, input: z.input<typeof profileSchema>) {
  requirePermission(ctx, "tenant.settings.manage");
  requireWritable(ctx);
  const data = profileSchema.parse(input);
  await db.$transaction(async (tx) => {
    await tx.tenant.update({
      where: { id: ctx.tenant.id },
      data: { ...data, contactEmail: data.contactEmail ?? null },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "restaurant.profile_updated",
      entityType: "Tenant",
      entityId: ctx.tenant.id,
    });
  });
}

export const operationalSettingsSchema = z
  .object({
    enableWaiterCalls: checkbox,
    enableBillRequests: checkbox,
    enableOrderTracking: checkbox,
    allowItemNotes: checkbox,
    taxEnabled: checkbox,
    taxLabel: z.string().trim().min(1).max(30),
    taxRatePercent: percentBpsSchema,
    taxInclusive: checkbox,
    serviceChargeEnabled: checkbox,
    serviceChargeLabel: z.string().trim().min(1).max(30),
    serviceChargePercent: percentBpsSchema,
    tableSessionIdleMinutes: z.coerce.number().int().min(15).max(1440),
    kitchenDelayWarningMinutes: z.coerce.number().int().min(1).max(240),
    maxItemQuantity: z.coerce.number().int().min(1).max(100),
    receiptHeader: optionalText(200),
    receiptFooter: optionalText(200),
  })
  .refine((s) => !s.taxEnabled || s.taxRatePercent > 0, {
    message: "Enter a tax rate or turn tax off.",
    path: ["taxRatePercent"],
  })
  .refine((s) => !s.serviceChargeEnabled || s.serviceChargePercent > 0, {
    message: "Enter a service charge rate or turn it off.",
    path: ["serviceChargePercent"],
  });

export async function updateOperationalSettings(ctx: TenantContext, input: z.input<typeof operationalSettingsSchema>) {
  requirePermission(ctx, "tenant.settings.manage");
  requireWritable(ctx);
  const { taxRatePercent, serviceChargePercent, ...rest } = operationalSettingsSchema.parse(input);
  await db.$transaction(async (tx) => {
    const before = await tx.restaurantSettings.findUnique({ where: { tenantId: ctx.tenant.id } });
    const data = { ...rest, taxRateBps: taxRatePercent, serviceChargeBps: serviceChargePercent };
    await tx.restaurantSettings.upsert({
      where: { tenantId: ctx.tenant.id },
      create: { tenantId: ctx.tenant.id, ...data },
      update: data,
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "restaurant.settings_updated",
      entityType: "RestaurantSettings",
      entityId: ctx.tenant.id,
      metadata: before
        ? {
            tax: {
              from: [before.taxEnabled, before.taxRateBps, before.taxInclusive],
              to: [rest.taxEnabled, taxRatePercent, rest.taxInclusive],
            },
            serviceCharge: {
              from: [before.serviceChargeEnabled, before.serviceChargeBps],
              to: [rest.serviceChargeEnabled, serviceChargePercent],
            },
          }
        : undefined,
    });
  });
}

// ───────────── Branches ─────────────

export async function listBranches(ctx: TenantContext) {
  const ids = [...ctx.branchRoles.keys()];
  return db.branch.findMany({
    where: { tenantId: ctx.tenant.id, id: { in: ids } },
    orderBy: { createdAt: "asc" },
    include: {
      stations: { orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }] },
      _count: { select: { tables: true } },
    },
  });
}

export const branchSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: slugSchema,
  addressLine: optionalText(160),
  phone: phoneSchema,
  timezone: timezoneSchema
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  fulfillmentMode: z.enum(FulfillmentMode),
});

export async function createBranch(ctx: TenantContext, input: z.input<typeof branchSchema>) {
  requirePermission(ctx, "branch.manage");
  requireWritable(ctx);
  const data = branchSchema.parse(input);
  const sub = await db.subscription.findUnique({ where: { tenantId: ctx.tenant.id }, include: { plan: true } });
  if (sub?.plan.maxBranches != null) {
    const count = await db.branch.count({ where: { tenantId: ctx.tenant.id } });
    if (count >= sub.plan.maxBranches)
      throw validation(`Your ${sub.plan.name} plan allows ${sub.plan.maxBranches} branch(es). Contact us to upgrade.`);
  }
  try {
    return await db.$transaction(async (tx) => {
      const branch = await tx.branch.create({
        data: { tenantId: ctx.tenant.id, ...data, timezone: data.timezone ?? null },
      });
      await tx.kitchenStation.create({
        data: { tenantId: ctx.tenant.id, branchId: branch.id, name: "Kitchen", isDefault: true },
      });
      await writeAudit(tx, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        action: "branch.created",
        entityType: "Branch",
        entityId: branch.id,
        metadata: { name: branch.name },
      });
      return branch;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A branch with this short name already exists.");
    throw e;
  }
}

export async function updateBranch(
  ctx: TenantContext,
  input: z.input<typeof branchSchema> & { branchId: string; isActive?: boolean },
) {
  requirePermission(ctx, "branch.manage");
  requireWritable(ctx);
  const data = branchSchema.parse(input);
  const branch = await db.branch.findFirst({ where: { id: idSchema.parse(input.branchId), tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  if (input.isActive === false) {
    const active = await db.branch.count({ where: { tenantId: ctx.tenant.id, isActive: true } });
    if (active <= 1 && branch.isActive) throw validation("At least one branch must stay active.");
  }
  try {
    await db.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id: branch.id },
        data: { ...data, timezone: data.timezone ?? null, isActive: input.isActive },
      });
      await writeAudit(tx, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        action: "branch.updated",
        entityType: "Branch",
        entityId: branch.id,
        metadata:
          branch.fulfillmentMode !== data.fulfillmentMode
            ? { fulfillmentMode: { from: branch.fulfillmentMode, to: data.fulfillmentMode } }
            : undefined,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A branch with this short name already exists.");
    throw e;
  }
}

// ───────────── Kitchen stations & routing ─────────────

export const stationSchema = z.object({ branchId: idSchema, name: z.string().trim().min(2).max(40) });

export async function createStation(ctx: TenantContext, input: z.input<typeof stationSchema>) {
  const data = stationSchema.parse(input);
  requirePermission(ctx, "printing.manage", data.branchId);
  requireWritable(ctx);
  const branch = await db.branch.findFirst({ where: { id: data.branchId, tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  try {
    return await db.kitchenStation.create({
      data: { tenantId: ctx.tenant.id, branchId: branch.id, name: data.name },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A station with this name already exists at this branch.");
    throw e;
  }
}

export async function setDefaultStation(ctx: TenantContext, input: { stationId: string }) {
  const station = await db.kitchenStation.findFirst({
    where: { id: idSchema.parse(input.stationId), tenantId: ctx.tenant.id },
  });
  if (!station) throw notFound("Station");
  requirePermission(ctx, "printing.manage", station.branchId);
  requireWritable(ctx);
  await db.$transaction([
    db.kitchenStation.updateMany({
      where: { branchId: station.branchId, tenantId: ctx.tenant.id, isDefault: true },
      data: { isDefault: false },
    }),
    db.kitchenStation.update({ where: { id: station.id }, data: { isDefault: true, isActive: true } }),
  ]);
}

export async function setStationActive(ctx: TenantContext, input: { stationId: string; active: boolean }) {
  const station = await db.kitchenStation.findFirst({
    where: { id: idSchema.parse(input.stationId), tenantId: ctx.tenant.id },
  });
  if (!station) throw notFound("Station");
  requirePermission(ctx, "printing.manage", station.branchId);
  requireWritable(ctx);
  if (!input.active && station.isDefault)
    throw validation("Choose another default station before turning this one off.");
  await db.kitchenStation.update({ where: { id: station.id }, data: { isActive: input.active } });
}

export async function getRouting(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "orders.view", branchId);
  const branch = await db.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  return db.kitchenRoutingRule.findMany({ where: { tenantId: ctx.tenant.id, branchId: branch.id } });
}

/** Routes a whole category (at one branch) to a station. stationId null = default station. */
export async function setCategoryRoute(
  ctx: TenantContext,
  input: { branchId: string; categoryId: string; stationId: string | null },
) {
  const branchId = idSchema.parse(input.branchId);
  const categoryId = idSchema.parse(input.categoryId);
  requirePermission(ctx, "printing.manage", branchId);
  requireWritable(ctx);
  const [branch, category] = await Promise.all([
    db.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenant.id } }),
    db.menuCategory.findFirst({ where: { id: categoryId, tenantId: ctx.tenant.id } }),
  ]);
  if (!branch) throw notFound("Branch");
  if (!category) throw notFound("Category");
  if (input.stationId === null) {
    await db.kitchenRoutingRule.deleteMany({ where: { tenantId: ctx.tenant.id, branchId, categoryId } });
    return;
  }
  const station = await db.kitchenStation.findFirst({
    where: { id: idSchema.parse(input.stationId), tenantId: ctx.tenant.id, branchId },
  });
  if (!station) throw notFound("Station");
  await db.kitchenRoutingRule.upsert({
    where: { branchId_categoryId: { branchId, categoryId } },
    create: { tenantId: ctx.tenant.id, branchId, categoryId, stationId: station.id },
    update: { stationId: station.id },
  });
}
