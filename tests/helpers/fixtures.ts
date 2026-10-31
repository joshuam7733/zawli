// Test fixtures: builds complete, isolated restaurants through the real services.
import { randomUUID } from "node:crypto";
import type { FulfillmentMode, TenantRole } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { loadTenantContext, type SessionUser, type TenantContext } from "@/server/authz";
import { createTenant } from "@/server/services/platform-tenants";
import {
  createCategory,
  createMenuItem,
  saveModifierGroup,
  saveVariants,
  setItemModifierGroups,
} from "@/server/services/menu";
import { createTable } from "@/server/services/tables";
import { setPasswordDirect } from "@/server/services/accounts";
import { randomToken } from "@/server/tokens";

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

export async function makeUser(
  opts: {
    email?: string;
    name?: string;
    platformRole?: "SUPER_ADMIN" | "PLATFORM_BILLING" | "PLATFORM_SUPPORT" | null;
  } = {},
): Promise<SessionUser> {
  const email = opts.email ?? `user-${uniq()}@example.test`;
  const user = await db.user.create({
    data: {
      id: randomToken(16),
      email,
      name: opts.name ?? "Test User",
      emailVerified: true,
      platformRole: opts.platformRole ?? null,
    },
  });
  await db.$transaction((tx) => setPasswordDirect(tx, user.id, "TestPassword123"));
  return { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole };
}

let planId: string | null = null;
export async function ensurePlan() {
  if (planId) return planId;
  const plan = await db.subscriptionPlan.upsert({
    where: { code: "test-plan" },
    create: { code: "test-plan", name: "Test plan", priceMinor: 100_000, currency: "UGX" },
    update: {},
  });
  planId = plan.id;
  return planId;
}

export interface TestRestaurant {
  tenantId: string;
  slug: string;
  branchId: string;
  secondBranchId: string;
  admin: SessionUser;
  owner: TenantContext;
  manager: TenantContext;
  waiter: TenantContext;
  kitchen: TenantContext;
  /** Waiter assigned ONLY to the second branch. */
  waiterBranch2: TenantContext;
  tableId: string;
  qrToken: string;
  table2Token: string;
  items: {
    burgerId: string;
    sodaId: string;
    sizeLargeId: string;
    sizeRegularId: string;
    sideChipsId: string;
    sideSaladId: string;
    extraCheeseId: string;
  };
}

async function addMember(tenantId: string, slug: string, role: TenantRole, branchIds: string[] | "all") {
  const user = await makeUser({ name: `${role} ${uniq()}` });
  const m = await db.membership.create({
    data: { tenantId, userId: user.id, role, allBranches: branchIds === "all" },
  });
  if (branchIds !== "all") {
    await db.staffBranchAssignment.createMany({
      data: branchIds.map((branchId) => ({ tenantId, membershipId: m.id, branchId, role })),
    });
  }
  return loadTenantContext(user, slug);
}

export async function makeRestaurant(
  opts: { name?: string; mode?: FulfillmentMode; serviceChargePercent?: number; activate?: boolean } = {},
): Promise<TestRestaurant> {
  const admin = await makeUser({ platformRole: "SUPER_ADMIN" });
  const slug = `r-${uniq()}`;
  const ownerEmail = `owner-${uniq()}@example.test`;
  const created = await createTenant(admin, {
    name: opts.name ?? `Restaurant ${slug}`,
    slug,
    branchName: "Main",
    ownerName: "Owner Person",
    ownerEmail,
    planId: await ensurePlan(),
    fulfillmentMode: opts.mode ?? "DIGITAL_DISPLAY",
    serviceChargeEnabled: (opts.serviceChargePercent ?? 0) > 0,
    serviceChargePercent: opts.serviceChargePercent ?? 0,
  });
  const ownerUser = await db.user.findUniqueOrThrow({ where: { email: ownerEmail } });
  await db.$transaction((tx) => setPasswordDirect(tx, ownerUser.id, "OwnerPassword123"));
  const owner = await loadTenantContext(
    { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email, platformRole: null },
    slug,
  );
  const branch = await db.branch.findFirstOrThrow({ where: { tenantId: created.tenantId } });
  const branch2 = await db.branch.create({ data: { tenantId: created.tenantId, name: "Second", slug: "second" } });
  await db.kitchenStation.create({
    data: { tenantId: created.tenantId, branchId: branch2.id, name: "Kitchen", isDefault: true },
  });

  // Reload owner so the new branch is in their branch map.
  const ownerCtx = await loadTenantContext(owner.user, slug);

  const cat = await createCategory(ownerCtx, { name: "Mains" });
  const drinks = await createCategory(ownerCtx, { name: "Drinks" });
  const burger = await createMenuItem(ownerCtx, {
    categoryId: cat.id,
    name: "Burger",
    basePriceMinor: 20_000,
    allergens: "Gluten",
  });
  await saveVariants(ownerCtx, {
    itemId: burger.id,
    variants: [
      { name: "Regular", priceMinor: 20_000 },
      { name: "Large", priceMinor: 26_000 },
    ],
  });
  const sideGroup = await saveModifierGroup(ownerCtx, {
    name: "Side",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { name: "Chips", priceDeltaMinor: 0 },
      { name: "Salad", priceDeltaMinor: 1_500 },
    ],
  });
  const extraGroup = await saveModifierGroup(ownerCtx, {
    name: "Extras",
    minSelect: 0,
    maxSelect: 2,
    options: [
      { name: "Cheese", priceDeltaMinor: 2_000 },
      { name: "Bacon", priceDeltaMinor: 4_000 },
    ],
  });
  await setItemModifierGroups(ownerCtx, { itemId: burger.id, groupIds: [sideGroup, extraGroup] });
  const soda = await createMenuItem(ownerCtx, { categoryId: drinks.id, name: "Soda", basePriceMinor: 3_000 });

  const table = await createTable(ownerCtx, { branchId: branch.id, label: "T1" });
  const table2 = await createTable(ownerCtx, { branchId: branch.id, label: "T2" });
  const qr = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table.id, status: "ACTIVE" } });
  const qr2 = await db.tableQrToken.findFirstOrThrow({ where: { tableId: table2.id, status: "ACTIVE" } });

  if (opts.activate !== false) {
    await db.tenant.update({ where: { id: created.tenantId }, data: { status: "ACTIVE" } });
  }

  const variants = await db.menuItemVariant.findMany({
    where: { menuItemId: burger.id },
    orderBy: { sortOrder: "asc" },
  });
  const options = await db.modifierOption.findMany({ where: { tenantId: created.tenantId } });
  const opt = (name: string) => options.find((o) => o.name === name)!.id;

  const [manager, waiter, kitchen, waiterBranch2] = await Promise.all([
    addMember(created.tenantId, slug, "MANAGER", "all"),
    addMember(created.tenantId, slug, "WAITER", [branch.id]),
    addMember(created.tenantId, slug, "KITCHEN", [branch.id]),
    addMember(created.tenantId, slug, "WAITER", [branch2.id]),
  ]);

  return {
    tenantId: created.tenantId,
    slug,
    branchId: branch.id,
    secondBranchId: branch2.id,
    admin,
    owner: await loadTenantContext(owner.user, slug),
    manager,
    waiter,
    kitchen,
    waiterBranch2,
    tableId: table.id,
    qrToken: qr.token,
    table2Token: qr2.token,
    items: {
      burgerId: burger.id,
      sodaId: soda.id,
      sizeRegularId: variants[0].id,
      sizeLargeId: variants[1].id,
      sideChipsId: opt("Chips"),
      sideSaladId: opt("Salad"),
      extraCheeseId: opt("Cheese"),
    },
  };
}

/** A valid cart: 1 large burger with salad + cheese, 2 sodas. Total = 26 000 + 3 500 + 6 000 = 35 500. */
export function sampleCart(r: TestRestaurant, token = r.qrToken) {
  return {
    token,
    idempotencyKey: randomUUID(),
    lines: [
      {
        menuItemId: r.items.burgerId,
        variantId: r.items.sizeLargeId,
        optionIds: [r.items.sideSaladId, r.items.extraCheeseId],
        quantity: 1,
        note: "No onions",
      },
      { menuItemId: r.items.sodaId, optionIds: [], quantity: 2 },
    ],
  };
}
export const SAMPLE_CART_TOTAL = 35_500;
