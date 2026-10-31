"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { parseMoneyInput } from "@/domain/money";
import { validation } from "@/server/errors";
import {
  archiveModifierGroup,
  createCategory,
  createMenuItem,
  moveCategory,
  saveModifierGroup,
  saveVariants,
  setBranchItemOverride,
  setCategoryArchived,
  setItemModifierGroups,
  setMenuItemArchived,
  setMenuItemAvailable,
  updateCategory,
  updateMenuItem,
} from "@/server/services/menu";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function money(fd: FormData, key: string, currency: string, label = "price"): number {
  const v = parseMoneyInput(s(fd, key), currency);
  if (v === null) throw validation(`Enter a valid ${label} (numbers only, e.g. 25000).`);
  return v;
}

function done(slug: string) {
  revalidatePath(`/app/${slug}/menu`, "layout");
}

export async function createCategoryAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await createCategory(ctx, { name: s(fd, "name"), description: s(fd, "description") });
    done(slug);
  }, "Category added");
}

export async function updateCategoryAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateCategory(ctx, {
      categoryId: s(fd, "categoryId"),
      name: s(fd, "name"),
      description: s(fd, "description"),
    });
    done(slug);
  }, "Category saved");
}

export async function archiveCategoryAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setCategoryArchived(ctx, { categoryId: s(fd, "categoryId"), archived: s(fd, "archived") === "true" });
    done(slug);
  });
}

export async function moveCategoryAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await moveCategory(ctx, {
      categoryId: s(fd, "categoryId"),
      direction: s(fd, "direction") === "up" ? "up" : "down",
    });
    done(slug);
  });
}

function itemFields(fd: FormData, currency: string) {
  return {
    categoryId: s(fd, "categoryId"),
    name: s(fd, "name"),
    description: s(fd, "description"),
    basePriceMinor: money(fd, "price", currency),
    allergens: s(fd, "allergens"),
    prepNotes: s(fd, "prepNotes"),
    imageUrl: s(fd, "imageUrl"),
    isAvailable: fd.get("isAvailable") === "on",
  };
}

export async function createItemAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  let itemId: string | null = null;
  const res = await runAction(async () => {
    const ctx = await getTenantContext(slug);
    const item = await createMenuItem(ctx, itemFields(fd, ctx.tenant.currency));
    itemId = item.id;
    done(slug);
  });
  if (res.ok && itemId) redirect(`/app/${slug}/menu/items/${itemId}?created=1`);
  return res;
}

export async function updateItemAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateMenuItem(ctx, { itemId: s(fd, "itemId"), ...itemFields(fd, ctx.tenant.currency) });
    done(slug);
  }, "Item saved");
}

export async function setItemAvailableAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setMenuItemAvailable(ctx, { itemId: s(fd, "itemId"), available: s(fd, "available") === "true" });
    done(slug);
  });
}

export async function archiveItemAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setMenuItemArchived(ctx, { itemId: s(fd, "itemId"), archived: s(fd, "archived") === "true" });
    done(slug);
  });
}

export async function branchOverrideAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const field = s(fd, "field");
    const value = s(fd, "value") === "true";
    await setBranchItemOverride(ctx, {
      itemId: s(fd, "itemId"),
      branchId: s(fd, "branchId"),
      ...(field === "offered" ? { isOffered: value } : { isAvailable: value }),
    });
    done(slug);
  });
}

export async function saveVariantsAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const ids = fd.getAll("variantId").map(String);
    const names = fd.getAll("variantName").map(String);
    const prices = fd.getAll("variantPrice").map(String);
    const available = new Set(fd.getAll("variantAvailable").map(String));
    const variants = names
      .map((name, i) => ({ id: ids[i] || undefined, name: name.trim(), price: prices[i], idx: i }))
      .filter((v) => v.name || v.price)
      .map((v) => {
        const priceMinor = parseMoneyInput(v.price ?? "", ctx.tenant.currency);
        if (priceMinor === null) throw validation(`Enter a valid price for “${v.name || "variant"}”.`);
        return { id: v.id, name: v.name, priceMinor, isAvailable: available.has(String(v.idx)) };
      });
    await saveVariants(ctx, { itemId: s(fd, "itemId"), variants });
    done(slug);
  }, "Sizes saved");
}

export async function setItemGroupsAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setItemModifierGroups(ctx, { itemId: s(fd, "itemId"), groupIds: fd.getAll("groupId").map(String) });
    done(slug);
  }, "Options saved");
}

export async function saveModifierGroupAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const ids = fd.getAll("optionId").map(String);
    const names = fd.getAll("optionName").map(String);
    const prices = fd.getAll("optionPrice").map(String);
    const available = new Set(fd.getAll("optionAvailable").map(String));
    const options = names
      .map((name, i) => ({ id: ids[i] || undefined, name: name.trim(), price: prices[i] || "0", idx: i }))
      .filter((o) => o.name)
      .map((o) => {
        const priceDeltaMinor = parseMoneyInput(o.price, ctx.tenant.currency);
        if (priceDeltaMinor === null) throw validation(`Enter a valid extra price for “${o.name}”.`);
        return { id: o.id, name: o.name, priceDeltaMinor, isAvailable: available.has(String(o.idx)) };
      });
    const required = fd.get("required") === "on";
    const maxSelect = Number(s(fd, "maxSelect") || "1");
    await saveModifierGroup(ctx, {
      groupId: s(fd, "groupId") || null,
      name: s(fd, "name"),
      minSelect: required ? Math.max(1, Number(s(fd, "minSelect") || "1")) : 0,
      maxSelect,
      options,
    });
    done(slug);
  }, "Option group saved");
}

export async function archiveModifierGroupAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await archiveModifierGroup(ctx, { groupId: s(fd, "groupId") });
    done(slug);
  });
}
