// Menu management: categories, items, variants, modifier groups, availability.
import { z } from "zod";
import { db } from "../db";
import { can, requirePermission, requireWritable, type TenantContext } from "../authz";
import { conflict, forbidden, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import { recordBranchEvent, signalBranch } from "../events";
import { checkbox, idSchema, minorAmountSchema, optionalText } from "../validation";

const tid = (ctx: TenantContext) => ctx.tenant.id;

// ───────────── Read ─────────────

export async function getMenuAdmin(ctx: TenantContext) {
  requirePermission(ctx, "orders.view");
  const [categories, groups, branches] = await Promise.all([
    db.menuCategory.findMany({
      where: { tenantId: tid(ctx) },
      orderBy: [{ isArchived: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
      include: {
        items: {
          orderBy: [{ isArchived: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
          include: {
            variants: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } },
            modifierGroups: { orderBy: { sortOrder: "asc" }, include: { modifierGroup: true } },
            branchSettings: true,
          },
        },
      },
    }),
    db.modifierGroup.findMany({
      where: { tenantId: tid(ctx), isArchived: false },
      orderBy: { name: "asc" },
      include: {
        options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } },
        _count: { select: { items: true } },
      },
    }),
    db.branch.findMany({ where: { tenantId: tid(ctx) }, orderBy: { createdAt: "asc" } }),
  ]);
  return { categories, groups, branches };
}

export async function getMenuItemAdmin(ctx: TenantContext, itemId: string) {
  requirePermission(ctx, "orders.view");
  const item = await db.menuItem.findFirst({
    where: { id: idSchema.parse(itemId), tenantId: tid(ctx) },
    include: {
      category: true,
      variants: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } },
      modifierGroups: {
        orderBy: { sortOrder: "asc" },
        include: {
          modifierGroup: { include: { options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } } },
        },
      },
      branchSettings: true,
    },
  });
  if (!item) throw notFound("Menu item");
  return item;
}

// ───────────── Categories ─────────────

export const categorySchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(60),
  description: optionalText(200),
});

function requireMenuManage(ctx: TenantContext) {
  requirePermission(ctx, "menu.manage");
  requireWritable(ctx);
}

async function touchMenu(ctx: TenantContext) {
  // Let open customer menus / staff screens know the menu changed.
  const branches = await db.branch.findMany({ where: { tenantId: tid(ctx) }, select: { id: true } });
  await db.branchEvent.createMany({
    data: branches.map((b) => ({ tenantId: tid(ctx), branchId: b.id, type: "menu.updated", entityId: tid(ctx) })),
  });
  for (const b of branches) signalBranch(b.id);
}

export async function createCategory(ctx: TenantContext, input: z.input<typeof categorySchema>) {
  requireMenuManage(ctx);
  const data = categorySchema.parse(input);
  const count = await db.menuCategory.count({ where: { tenantId: tid(ctx) } });
  const category = await db.menuCategory.create({ data: { tenantId: tid(ctx), ...data, sortOrder: count } });
  await touchMenu(ctx);
  return category;
}

export async function updateCategory(
  ctx: TenantContext,
  input: z.input<typeof categorySchema> & { categoryId: string; isArchived?: boolean },
) {
  requireMenuManage(ctx);
  const data = categorySchema.parse(input);
  const id = idSchema.parse(input.categoryId);
  const res = await db.menuCategory.updateMany({
    where: { id, tenantId: tid(ctx) },
    data: { ...data, isArchived: input.isArchived },
  });
  if (res.count === 0) throw notFound("Category");
  await touchMenu(ctx);
}

export async function setCategoryArchived(ctx: TenantContext, input: { categoryId: string; archived: boolean }) {
  requireMenuManage(ctx);
  const res = await db.menuCategory.updateMany({
    where: { id: idSchema.parse(input.categoryId), tenantId: tid(ctx) },
    data: { isArchived: input.archived },
  });
  if (res.count === 0) throw notFound("Category");
  await touchMenu(ctx);
}

/** Moves a category one position up or down. */
export async function moveCategory(ctx: TenantContext, input: { categoryId: string; direction: "up" | "down" }) {
  requireMenuManage(ctx);
  const categories = await db.menuCategory.findMany({
    where: { tenantId: tid(ctx), isArchived: false },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true },
  });
  const ids = categories.map((c) => c.id);
  const i = ids.indexOf(input.categoryId);
  if (i === -1) throw notFound("Category");
  const j = input.direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  await db.$transaction(
    ids.map((id, index) =>
      db.menuCategory.updateMany({ where: { id, tenantId: tid(ctx) }, data: { sortOrder: index } }),
    ),
  );
  await touchMenu(ctx);
}

// ───────────── Items ─────────────

export const itemSchema = z.object({
  categoryId: idSchema,
  name: z.string().trim().min(1, "Enter an item name.").max(80),
  description: optionalText(400),
  basePriceMinor: minorAmountSchema,
  allergens: optionalText(200),
  prepNotes: optionalText(300),
  imageUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/uploads\/[A-Za-z0-9_\-/.]+$/, "Invalid image.")
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  isAvailable: checkbox.default(true),
});

async function assertCategory(ctx: TenantContext, categoryId: string) {
  const cat = await db.menuCategory.findFirst({ where: { id: categoryId, tenantId: tid(ctx) } });
  if (!cat) throw notFound("Category");
  return cat;
}

export async function createMenuItem(ctx: TenantContext, input: z.input<typeof itemSchema>) {
  requireMenuManage(ctx);
  const data = itemSchema.parse(input);
  await assertCategory(ctx, data.categoryId);
  const count = await db.menuItem.count({ where: { tenantId: tid(ctx), categoryId: data.categoryId } });
  const item = await db.$transaction(async (tx) => {
    const created = await tx.menuItem.create({
      data: { tenantId: tid(ctx), ...data, imageUrl: data.imageUrl ?? null, sortOrder: count },
    });
    await writeAudit(tx, {
      tenantId: tid(ctx),
      actorId: ctx.user.id,
      action: "menu.item_created",
      entityType: "MenuItem",
      entityId: created.id,
      metadata: { name: created.name, priceMinor: created.basePriceMinor },
    });
    return created;
  });
  await touchMenu(ctx);
  return item;
}

export async function updateMenuItem(ctx: TenantContext, input: z.input<typeof itemSchema> & { itemId: string }) {
  requireMenuManage(ctx);
  const data = itemSchema.parse(input);
  const itemId = idSchema.parse(input.itemId);
  const existing = await db.menuItem.findFirst({ where: { id: itemId, tenantId: tid(ctx) } });
  if (!existing) throw notFound("Menu item");
  await assertCategory(ctx, data.categoryId);
  await db.$transaction(async (tx) => {
    await tx.menuItem.update({ where: { id: existing.id }, data: { ...data, imageUrl: data.imageUrl ?? null } });
    if (existing.basePriceMinor !== data.basePriceMinor) {
      await writeAudit(tx, {
        tenantId: tid(ctx),
        actorId: ctx.user.id,
        action: "menu.price_changed",
        entityType: "MenuItem",
        entityId: existing.id,
        metadata: { from: existing.basePriceMinor, to: data.basePriceMinor },
      });
    }
  });
  await touchMenu(ctx);
}

export async function setMenuItemArchived(ctx: TenantContext, input: { itemId: string; archived: boolean }) {
  requireMenuManage(ctx);
  // Archiving never deletes: past orders keep their snapshots and references.
  const res = await db.menuItem.updateMany({
    where: { id: idSchema.parse(input.itemId), tenantId: tid(ctx) },
    data: { isArchived: input.archived },
  });
  if (res.count === 0) throw notFound("Menu item");
  await touchMenu(ctx);
}

/**
 * Global "sold out" switch (all branches). Allowed for menu managers and for staff
 * with availability permission (kitchen) at EVERY branch.
 */
export async function setMenuItemAvailable(ctx: TenantContext, input: { itemId: string; available: boolean }) {
  if (!can(ctx, "menu.manage")) {
    const branches = await db.branch.findMany({ where: { tenantId: tid(ctx) }, select: { id: true } });
    if (!branches.every((b) => can(ctx, "menu.availability", b.id))) throw forbidden();
  }
  requireWritable(ctx);
  const res = await db.menuItem.updateMany({
    where: { id: idSchema.parse(input.itemId), tenantId: tid(ctx) },
    data: { isAvailable: input.available },
  });
  if (res.count === 0) throw notFound("Menu item");
  await touchMenu(ctx);
}

/** Branch-level offer / availability override. */
export async function setBranchItemOverride(
  ctx: TenantContext,
  input: { itemId: string; branchId: string; isOffered?: boolean; isAvailable?: boolean },
) {
  const itemId = idSchema.parse(input.itemId);
  const branchId = idSchema.parse(input.branchId);
  // Changing what a branch OFFERS is menu management; toggling sold-out is availability.
  requirePermission(ctx, input.isOffered !== undefined ? "menu.manage" : "menu.availability", branchId);
  requireWritable(ctx);
  const [item, branch] = await Promise.all([
    db.menuItem.findFirst({ where: { id: itemId, tenantId: tid(ctx) } }),
    db.branch.findFirst({ where: { id: branchId, tenantId: tid(ctx) } }),
  ]);
  if (!item) throw notFound("Menu item");
  if (!branch) throw notFound("Branch");
  await db.$transaction(async (tx) => {
    await tx.menuItemBranch.upsert({
      where: { menuItemId_branchId: { menuItemId: item.id, branchId: branch.id } },
      create: {
        tenantId: tid(ctx),
        menuItemId: item.id,
        branchId: branch.id,
        isOffered: input.isOffered ?? true,
        isAvailable: input.isAvailable ?? true,
      },
      update: { isOffered: input.isOffered, isAvailable: input.isAvailable },
    });
    await recordBranchEvent(tx, { tenantId: tid(ctx), branchId: branch.id, type: "menu.updated", entityId: item.id });
  });
  signalBranch(branch.id);
}

// ───────────── Variants ─────────────

export const variantsSchema = z
  .array(
    z.object({
      id: idSchema.optional(),
      name: z.string().trim().min(1, "Name each size/variant.").max(40),
      priceMinor: minorAmountSchema,
      isAvailable: z.boolean().default(true),
    }),
  )
  .max(12);

/**
 * Replaces the item's variant list. Existing variants are updated in place,
 * removed ones are archived (old orders still reference them).
 */
export async function saveVariants(
  ctx: TenantContext,
  input: { itemId: string; variants: z.input<typeof variantsSchema> },
) {
  requireMenuManage(ctx);
  const variants = variantsSchema.parse(input.variants);
  const item = await db.menuItem.findFirst({
    where: { id: idSchema.parse(input.itemId), tenantId: tid(ctx) },
    include: { variants: { where: { isArchived: false } } },
  });
  if (!item) throw notFound("Menu item");
  const names = new Set<string>();
  for (const v of variants) {
    const key = v.name.toLowerCase();
    if (names.has(key)) throw validation(`Variant “${v.name}” is listed twice.`);
    names.add(key);
    if (v.id && !item.variants.some((x) => x.id === v.id)) throw notFound("Variant");
  }
  await db.$transaction(async (tx) => {
    const keep = new Set(variants.filter((v) => v.id).map((v) => v.id));
    await tx.menuItemVariant.updateMany({
      where: { menuItemId: item.id, tenantId: tid(ctx), isArchived: false, id: { notIn: [...keep] as string[] } },
      data: { isArchived: true },
    });
    for (const [i, v] of variants.entries()) {
      if (v.id) {
        await tx.menuItemVariant.update({
          where: { id: v.id },
          data: { name: v.name, priceMinor: v.priceMinor, isAvailable: v.isAvailable, sortOrder: i },
        });
      } else {
        await tx.menuItemVariant.create({
          data: {
            tenantId: tid(ctx),
            menuItemId: item.id,
            name: v.name,
            priceMinor: v.priceMinor,
            isAvailable: v.isAvailable,
            sortOrder: i,
          },
        });
      }
    }
  });
  await touchMenu(ctx);
}

// ───────────── Modifier groups ─────────────

export const modifierGroupSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a group name.").max(60),
    minSelect: z.coerce.number().int().min(0).max(20),
    maxSelect: z.coerce.number().int().min(1).max(20),
    options: z
      .array(
        z.object({
          id: idSchema.optional(),
          name: z.string().trim().min(1, "Name each option.").max(60),
          priceDeltaMinor: minorAmountSchema,
          isAvailable: z.boolean().default(true),
        }),
      )
      .min(1, "Add at least one option.")
      .max(30),
  })
  .refine((g) => g.minSelect <= g.maxSelect, {
    message: "Minimum cannot be greater than maximum.",
    path: ["minSelect"],
  })
  .refine((g) => g.maxSelect <= g.options.length, {
    message: "Maximum cannot exceed the number of options.",
    path: ["maxSelect"],
  });

export async function saveModifierGroup(
  ctx: TenantContext,
  input: z.input<typeof modifierGroupSchema> & { groupId?: string | null },
) {
  requireMenuManage(ctx);
  const data = modifierGroupSchema.parse(input);
  return db
    .$transaction(async (tx) => {
      let groupId = input.groupId ? idSchema.parse(input.groupId) : null;
      if (groupId) {
        const existing = await tx.modifierGroup.findFirst({
          where: { id: groupId, tenantId: tid(ctx) },
          include: { options: { where: { isArchived: false } } },
        });
        if (!existing) throw notFound("Modifier group");
        for (const o of data.options)
          if (o.id && !existing.options.some((x) => x.id === o.id)) throw notFound("Modifier option");
        await tx.modifierGroup.update({
          where: { id: existing.id },
          data: { name: data.name, minSelect: data.minSelect, maxSelect: data.maxSelect },
        });
        const keep = data.options.filter((o) => o.id).map((o) => o.id as string);
        await tx.modifierOption.updateMany({
          where: { groupId: existing.id, tenantId: tid(ctx), isArchived: false, id: { notIn: keep } },
          data: { isArchived: true },
        });
      } else {
        const created = await tx.modifierGroup.create({
          data: { tenantId: tid(ctx), name: data.name, minSelect: data.minSelect, maxSelect: data.maxSelect },
        });
        groupId = created.id;
      }
      for (const [i, o] of data.options.entries()) {
        if (o.id) {
          await tx.modifierOption.update({
            where: { id: o.id },
            data: { name: o.name, priceDeltaMinor: o.priceDeltaMinor, isAvailable: o.isAvailable, sortOrder: i },
          });
        } else {
          await tx.modifierOption.create({
            data: {
              tenantId: tid(ctx),
              groupId,
              name: o.name,
              priceDeltaMinor: o.priceDeltaMinor,
              isAvailable: o.isAvailable,
              sortOrder: i,
            },
          });
        }
      }
      return groupId;
    })
    .then(async (id) => {
      await touchMenu(ctx);
      return id;
    });
}

export async function archiveModifierGroup(ctx: TenantContext, input: { groupId: string }) {
  requireMenuManage(ctx);
  const group = await db.modifierGroup.findFirst({ where: { id: idSchema.parse(input.groupId), tenantId: tid(ctx) } });
  if (!group) throw notFound("Modifier group");
  await db.$transaction([
    db.menuItemModifierGroup.deleteMany({ where: { modifierGroupId: group.id, tenantId: tid(ctx) } }),
    db.modifierGroup.update({ where: { id: group.id }, data: { isArchived: true } }),
  ]);
  await touchMenu(ctx);
}

/** Sets which modifier groups apply to an item, in order. */
export async function setItemModifierGroups(ctx: TenantContext, input: { itemId: string; groupIds: string[] }) {
  requireMenuManage(ctx);
  const itemId = idSchema.parse(input.itemId);
  const groupIds = z.array(idSchema).max(10).parse(input.groupIds);
  if (new Set(groupIds).size !== groupIds.length) throw validation("A modifier group is listed twice.");
  const item = await db.menuItem.findFirst({ where: { id: itemId, tenantId: tid(ctx) } });
  if (!item) throw notFound("Menu item");
  const groups = await db.modifierGroup.findMany({
    where: { id: { in: groupIds }, tenantId: tid(ctx), isArchived: false },
    select: { id: true },
  });
  if (groups.length !== groupIds.length) throw notFound("Modifier group");
  await db.$transaction([
    db.menuItemModifierGroup.deleteMany({ where: { menuItemId: item.id, tenantId: tid(ctx) } }),
    db.menuItemModifierGroup.createMany({
      data: groupIds.map((g, i) => ({ tenantId: tid(ctx), menuItemId: item.id, modifierGroupId: g, sortOrder: i })),
    }),
  ]);
  await touchMenu(ctx);
}

export async function assertNoDuplicateCategoryName(ctx: TenantContext, name: string) {
  const exists = await db.menuCategory.findFirst({
    where: { tenantId: tid(ctx), isArchived: false, name: { equals: name, mode: "insensitive" } },
  });
  if (exists) throw conflict("A category with this name already exists.");
}
