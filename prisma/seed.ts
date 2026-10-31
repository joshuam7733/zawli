/**
 * DEVELOPMENT SEED — clearly fictional demo data.
 *
 *  * Repeatable: everything is upserted by natural keys (plan code, email, tenant
 *    slug). If a demo restaurant already exists its menu/tables are left alone,
 *    so running the seed twice never duplicates or erases data.
 *  * Never creates production credentials: refuses to run when NODE_ENV=production.
 *  * Demo passwords are documented in docs/LOCAL_SETUP.md and are for local use only.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { db, type Tx } from "../src/server/db";
import { setPasswordDirect } from "../src/server/services/accounts";
import { placeOrder } from "../src/server/services/ordering";
import { loadTenantContext } from "../src/server/authz";
import { advanceTicket, markOrderServing } from "../src/server/services/orders";
import { recordPayment } from "../src/server/services/payments";
import { randomToken } from "../src/server/tokens";
import type { FulfillmentMode, PlatformRole, TenantRole } from "../src/generated/prisma/enums";

if (process.env.NODE_ENV === "production" && process.env.ZAWLI_ALLOW_DEMO_SEED !== "1") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const DEMO_PASSWORD = "ZawliDemo2026";

async function upsertUser(tx: Tx, email: string, name: string, platformRole: PlatformRole | null = null) {
  const user = await tx.user.upsert({
    where: { email },
    create: { id: randomToken(16), email, name, emailVerified: true, platformRole },
    update: { platformRole },
  });
  const hasPassword = await tx.account.count({
    where: { userId: user.id, providerId: "credential", password: { not: null } },
  });
  if (!hasPassword) await setPasswordDirect(tx, user.id, DEMO_PASSWORD);
  return user;
}

async function seedPlans() {
  const plans = [
    {
      code: "starter",
      name: "Starter",
      priceMinor: 150_000,
      maxBranches: 1,
      description: "Placeholder development pricing — one branch.",
    },
    {
      code: "growth",
      name: "Growth",
      priceMinor: 350_000,
      maxBranches: 3,
      description: "Placeholder development pricing — up to three branches.",
    },
    {
      code: "multi-branch",
      name: "Multi-branch",
      priceMinor: 900_000,
      maxBranches: null,
      description: "Placeholder development pricing — unlimited branches.",
    },
  ];
  for (const p of plans) {
    await db.subscriptionPlan.upsert({
      where: { code: p.code },
      create: { ...p, currency: "UGX", billingInterval: "MONTHLY" },
      update: {},
    });
  }
  return db.subscriptionPlan.findMany();
}

interface MenuSpec {
  category: string;
  station?: string;
  items: {
    name: string;
    description?: string;
    price: number;
    allergens?: string;
    prepNotes?: string;
    variants?: [string, number][];
    groups?: string[];
    unavailable?: boolean;
  }[];
}

interface DemoSpec {
  slug: string;
  name: string;
  city: string;
  address: string;
  phone: string;
  brandPrimary: string;
  brandAccent: string;
  planCode: string;
  subscription: "ACTIVE" | "TRIAL";
  settings: { serviceChargeEnabled?: boolean; serviceChargeBps?: number };
  branches: {
    slug: string;
    name: string;
    address: string;
    mode: FulfillmentMode;
    stations: string[];
    tables: string[];
  }[];
  staff: { email: string; name: string; role: TenantRole; allBranches?: boolean; branches?: string[] }[];
  groups: { name: string; min: number; max: number; options: [string, number][] }[];
  menu: MenuSpec[];
}

const KAMPALA_GRILL: DemoSpec = {
  slug: "kampala-grill",
  name: "Kampala Grill",
  city: "Kampala",
  address: "Plot 00, Demo Road, Kololo (fictional)",
  phone: "+256 700 000 001",
  brandPrimary: "#14532D",
  brandAccent: "#A3E635",
  planCode: "growth",
  subscription: "ACTIVE",
  settings: {},
  branches: [
    {
      slug: "kololo",
      name: "Kololo",
      address: "Kololo (fictional address)",
      mode: "DIGITAL_DISPLAY",
      stations: ["Kitchen", "Grill", "Bar"],
      tables: ["1", "2", "3", "4", "5", "6", "7", "8"],
    },
    {
      slug: "ntinda",
      name: "Ntinda",
      address: "Ntinda (fictional address)",
      mode: "DIGITAL_AND_PRINTER",
      stations: ["Kitchen"],
      tables: ["A1", "A2", "A3", "A4"],
    },
  ],
  staff: [
    { email: "owner@kampala-grill.test", name: "Grace Nansubuga (demo)", role: "RESTAURANT_OWNER", allBranches: true },
    { email: "manager@kampala-grill.test", name: "Brian Okello (demo)", role: "MANAGER", allBranches: true },
    { email: "waiter@kampala-grill.test", name: "Sarah Akello (demo)", role: "WAITER", branches: ["kololo"] },
    { email: "kitchen@kampala-grill.test", name: "Joseph Mugisha (demo)", role: "KITCHEN", branches: ["kololo"] },
  ],
  groups: [
    {
      name: "Choose a side",
      min: 1,
      max: 1,
      options: [
        ["Chips", 0],
        ["Matooke", 0],
        ["Rice", 0],
        ["Gonja", 2_000],
      ],
    },
    {
      name: "Extras",
      min: 0,
      max: 3,
      options: [
        ["Extra kachumbari", 2_000],
        ["Avocado", 3_000],
        ["Chilli sauce", 0],
      ],
    },
    {
      name: "Ice",
      min: 0,
      max: 1,
      options: [
        ["No ice", 0],
        ["Extra ice", 0],
      ],
    },
  ],
  menu: [
    {
      category: "Grills",
      station: "Grill",
      items: [
        {
          name: "Nyama choma (goat)",
          description: "Slow-grilled goat, kachumbari on the side.",
          price: 35_000,
          variants: [
            ["Half kg", 35_000],
            ["1 kg", 65_000],
          ],
          groups: ["Choose a side", "Extras"],
        },
        {
          name: "Grilled tilapia",
          description: "Whole Lake Victoria tilapia, lemon and herbs.",
          price: 45_000,
          groups: ["Choose a side", "Extras"],
          allergens: "Fish",
        },
        {
          name: "Chicken muchomo",
          description: "Quarter chicken, charcoal grilled.",
          price: 22_000,
          groups: ["Choose a side"],
        },
      ],
    },
    {
      category: "Local favourites",
      items: [
        {
          name: "Chicken luwombo",
          description: "Chicken stewed in banana leaves with groundnut sauce.",
          price: 30_000,
          allergens: "Peanuts",
          prepNotes: "Steam 25 min",
          groups: ["Choose a side"],
        },
        {
          name: "Rolex",
          description: "Chapati rolled with eggs, tomato, onion and cabbage.",
          price: 8_000,
          allergens: "Egg, gluten",
          groups: ["Extras"],
        },
        { name: "Beef pilau", description: "Spiced rice with tender beef.", price: 18_000, unavailable: true },
      ],
    },
    {
      category: "Sides",
      items: [
        { name: "Chips", price: 6_000 },
        { name: "Kachumbari", price: 4_000 },
      ],
    },
    {
      category: "Drinks",
      station: "Bar",
      items: [
        {
          name: "Fresh passion juice",
          price: 7_000,
          variants: [
            ["Glass", 7_000],
            ["Jug", 18_000],
          ],
          groups: ["Ice"],
        },
        { name: "Soda", price: 3_000, groups: ["Ice"] },
        { name: "Mineral water", price: 2_500 },
      ],
    },
  ],
};

const LAKESIDE_CAFE: DemoSpec = {
  slug: "lakeside-cafe",
  name: "Lakeside Café",
  city: "Entebbe",
  address: "Demo Lane, Entebbe (fictional)",
  phone: "+256 700 000 002",
  brandPrimary: "#1E3A5F",
  brandAccent: "#F2C14E",
  planCode: "starter",
  subscription: "TRIAL",
  settings: { serviceChargeEnabled: true, serviceChargeBps: 500 },
  branches: [
    {
      slug: "main",
      name: "Lakeside",
      address: "Entebbe (fictional address)",
      mode: "PRINTER",
      stations: ["Kitchen", "Coffee bar"],
      tables: ["Patio 1", "Patio 2", "Window", "Counter"],
    },
  ],
  staff: [
    { email: "owner@lakeside-cafe.test", name: "Daniel Ssempala (demo)", role: "RESTAURANT_OWNER", allBranches: true },
    { email: "waiter@lakeside-cafe.test", name: "Ruth Namata (demo)", role: "WAITER", branches: ["main"] },
    { email: "kitchen@lakeside-cafe.test", name: "Peter Kato (demo)", role: "KITCHEN", branches: ["main"] },
  ],
  groups: [
    {
      name: "Milk",
      min: 1,
      max: 1,
      options: [
        ["Whole milk", 0],
        ["Oat milk", 2_000],
      ],
    },
    {
      name: "Add-ons",
      min: 0,
      max: 2,
      options: [
        ["Extra shot", 2_500],
        ["Vanilla syrup", 1_500],
      ],
    },
  ],
  menu: [
    {
      category: "Coffee",
      station: "Coffee bar",
      items: [
        { name: "Espresso", price: 6_000, groups: ["Add-ons"] },
        {
          name: "Café latte",
          price: 9_000,
          variants: [
            ["Regular", 9_000],
            ["Large", 11_000],
          ],
          groups: ["Milk", "Add-ons"],
          allergens: "Milk",
        },
        { name: "African tea", description: "Spiced milky tea.", price: 5_000, allergens: "Milk" },
      ],
    },
    {
      category: "Breakfast",
      items: [
        {
          name: "Full breakfast",
          description: "Eggs, sausages, beans, toast and fruit.",
          price: 28_000,
          allergens: "Egg, gluten",
        },
        { name: "Pancakes with honey", price: 16_000, allergens: "Egg, gluten, milk" },
      ],
    },
  ],
};

async function seedTenant(spec: DemoSpec, planId: string) {
  const existing = await db.tenant.findUnique({ where: { slug: spec.slug } });
  if (existing) {
    console.log(`  • ${spec.name}: exists — leaving menu, tables and orders untouched`);
    return existing;
  }
  // All-or-nothing: a failure never leaves a half-built demo restaurant behind.
  return db.$transaction((tx) => buildTenant(tx, spec, planId), { timeout: 120_000 });
}

async function buildTenant(tx: Tx, spec: DemoSpec, planId: string) {
  const tenant = await tx.tenant.create({
    data: {
      slug: spec.slug,
      name: spec.name,
      isDemo: true,
      status: "ACTIVE",
      onboardingCompletedAt: new Date(),
      brandPrimary: spec.brandPrimary,
      brandAccent: spec.brandAccent,
      city: spec.city,
      addressLine: spec.address,
      contactPhone: spec.phone,
      settings: { create: { ...spec.settings } },
    },
  });

  const branchIds = new Map<string, string>();
  const stationIds = new Map<string, string>(); // `${branchSlug}:${name}`
  for (const b of spec.branches) {
    const branch = await tx.branch.create({
      data: { tenantId: tenant.id, slug: b.slug, name: b.name, addressLine: b.address, fulfillmentMode: b.mode },
    });
    branchIds.set(b.slug, branch.id);
    for (const [i, name] of b.stations.entries()) {
      const st = await tx.kitchenStation.create({
        data: { tenantId: tenant.id, branchId: branch.id, name, isDefault: i === 0, sortOrder: i },
      });
      stationIds.set(`${b.slug}:${name}`, st.id);
    }
    for (const [i, label] of b.tables.entries()) {
      const table = await tx.diningTable.create({
        data: { tenantId: tenant.id, branchId: branch.id, label, sortOrder: i, seats: 4 },
      });
      await tx.tableQrToken.create({
        data: { tenantId: tenant.id, branchId: branch.id, tableId: table.id, token: randomToken() },
      });
    }
    if (b.mode === "PRINTER" || b.mode === "DIGITAL_AND_PRINTER") {
      await tx.printerConfiguration.create({
        data: {
          tenantId: tenant.id,
          branchId: branch.id,
          name: "Kitchen printer (browser)",
          connection: "BROWSER",
          paperWidthMm: 80,
        },
      });
    }
  }

  for (const s of spec.staff) {
    const user = await upsertUser(tx, s.email, s.name);
    const m = await tx.membership.create({
      data: { tenantId: tenant.id, userId: user.id, role: s.role, allBranches: !!s.allBranches },
    });
    for (const slug of s.branches ?? []) {
      await tx.staffBranchAssignment.create({
        data: { tenantId: tenant.id, membershipId: m.id, branchId: branchIds.get(slug)!, role: s.role },
      });
    }
  }

  const groupIds = new Map<string, string>();
  for (const g of spec.groups) {
    const group = await tx.modifierGroup.create({
      data: {
        tenantId: tenant.id,
        name: g.name,
        minSelect: g.min,
        maxSelect: g.max,
        // tenantId is inherited through the composite (tenantId, groupId) relation.
        options: { create: g.options.map(([name, price], i) => ({ name, priceDeltaMinor: price, sortOrder: i })) },
      },
    });
    groupIds.set(g.name, group.id);
  }

  for (const [ci, c] of spec.menu.entries()) {
    const category = await tx.menuCategory.create({ data: { tenantId: tenant.id, name: c.category, sortOrder: ci } });
    if (c.station) {
      for (const b of spec.branches) {
        const stationId = stationIds.get(`${b.slug}:${c.station}`);
        if (stationId)
          await tx.kitchenRoutingRule.create({
            data: { tenantId: tenant.id, branchId: branchIds.get(b.slug)!, categoryId: category.id, stationId },
          });
      }
    }
    for (const [ii, it] of c.items.entries()) {
      const item = await tx.menuItem.create({
        data: {
          tenantId: tenant.id,
          categoryId: category.id,
          name: it.name,
          description: it.description ?? null,
          basePriceMinor: it.price,
          allergens: it.allergens ?? null,
          prepNotes: it.prepNotes ?? null,
          isAvailable: !it.unavailable,
          sortOrder: ii,
        },
      });
      for (const [vi, [name, price]] of (it.variants ?? []).entries()) {
        await tx.menuItemVariant.create({
          data: { tenantId: tenant.id, menuItemId: item.id, name, priceMinor: price, sortOrder: vi },
        });
      }
      for (const [gi, gname] of (it.groups ?? []).entries()) {
        await tx.menuItemModifierGroup.create({
          data: { tenantId: tenant.id, menuItemId: item.id, modifierGroupId: groupIds.get(gname)!, sortOrder: gi },
        });
      }
    }
  }

  const now = new Date();
  const sub = await tx.subscription.create({
    data: {
      tenantId: tenant.id,
      planId,
      status: spec.subscription,
      trialEndsAt: spec.subscription === "TRIAL" ? new Date(now.getTime() + 14 * 86_400_000) : null,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
  await tx.subscriptionEvent.create({
    data: { tenantId: tenant.id, subscriptionId: sub.id, toStatus: spec.subscription, reason: "Demo seed" },
  });
  console.log(`  • ${spec.name}: created (${spec.branches.length} branch(es), ${spec.staff.length} staff)`);
  return tenant;
}

/** A few demo orders in different states so the dashboards are not empty. */
async function seedDemoOrders(slug: string) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug } });
  if ((await db.order.count({ where: { tenantId: tenant.id } })) > 0) return;
  const tokens = await db.tableQrToken.findMany({
    where: { tenantId: tenant.id, status: "ACTIVE", branch: { slug: "kololo" } },
    include: { table: true },
    orderBy: { table: { sortOrder: "asc" } },
  });
  const items = await db.menuItem.findMany({
    where: { tenantId: tenant.id, isAvailable: true },
    include: { variants: true, modifierGroups: { include: { modifierGroup: { include: { options: true } } } } },
  });
  const pick = (name: string) => items.find((i) => i.name === name)!;
  const line = (name: string, quantity = 1, variantIdx = 0) => {
    const it = pick(name);
    return {
      menuItemId: it.id,
      variantId: it.variants[variantIdx]?.id ?? null,
      optionIds: it.modifierGroups
        .filter((g) => g.modifierGroup.minSelect > 0)
        .map((g) => g.modifierGroup.options[0].id),
      quantity,
    };
  };
  const owner = await db.user.findUniqueOrThrow({ where: { email: "owner@kampala-grill.test" } });
  const ctx = await loadTenantContext({ id: owner.id, name: owner.name, email: owner.email, platformRole: null }, slug);

  const carts = [
    [line("Nyama choma (goat)", 1, 1), line("Fresh passion juice", 2)],
    [line("Rolex", 2), line("Soda", 2)],
    [line("Grilled tilapia"), line("Chips"), line("Mineral water", 2)],
    [line("Chicken luwombo"), line("Fresh passion juice", 1, 1)],
    [line("Chicken muchomo", 2)],
  ];
  const placed = [];
  for (const [i, lines] of carts.entries()) {
    placed.push(await placeOrder({ token: tokens[i % tokens.length].token, idempotencyKey: randomUUID(), lines }));
  }
  const orders = await db.order.findMany({
    where: { tenantId: tenant.id },
    orderBy: { orderNumber: "asc" },
    include: { tickets: true },
  });
  // Order 1: completed (served + paid). Order 2: ready. Order 3: preparing. 4-5: new.
  const progress = async (orderIdx: number, to: "ACKNOWLEDGED" | "PREPARING" | "READY") => {
    for (const t of orders[orderIdx].tickets) {
      for (const step of ["ACKNOWLEDGED", "PREPARING", "READY"] as const) {
        await advanceTicket(ctx, { ticketId: t.id, to: step });
        if (step === to) break;
      }
    }
  };
  await progress(0, "READY");
  await markOrderServing(ctx, { orderId: orders[0].id, to: "SERVED" });
  await recordPayment(ctx, {
    orderId: orders[0].id,
    amountMinor: orders[0].totalMinor,
    method: "MOBILE_MONEY",
    reference: "DEMO-TXN-001",
  });
  await progress(1, "READY");
  await progress(2, "PREPARING");
  console.log(`  • ${slug}: ${placed.length} demo orders placed`);
}

async function main() {
  console.log("Seeding development data (fictional)…");
  const plans = await seedPlans();
  const planId = (code: string) => plans.find((p) => p.code === code)!.id;

  await db.$transaction(async (tx) => {
    await upsertUser(tx, "admin@zawli.test", "Platform Admin (dev)", "SUPER_ADMIN");
    await upsertUser(tx, "billing@zawli.test", "Billing Admin (dev)", "PLATFORM_BILLING");
  });

  await seedTenant(KAMPALA_GRILL, planId(KAMPALA_GRILL.planCode));
  await seedTenant(LAKESIDE_CAFE, planId(LAKESIDE_CAFE.planCode));
  await seedDemoOrders("kampala-grill");

  // Kampala Grill demonstrates pay-first: MTN MoMo and Airtel Money in SIMULATOR mode
  // (no real money). Created once; later changes made in the app are kept.
  const grill = await db.tenant.findUniqueOrThrow({ where: { slug: "kampala-grill" } });
  for (const provider of ["MTN_MOMO", "AIRTEL_MONEY"] as const) {
    await db.mobileMoneyAccount.upsert({
      where: { tenantId_provider: { tenantId: grill.id, provider } },
      create: { tenantId: grill.id, provider, isEnabled: true, environment: "SIMULATOR" },
      update: {},
    });
  }

  console.log(`Done. Demo password for every seeded account: ${DEMO_PASSWORD} (development only).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
