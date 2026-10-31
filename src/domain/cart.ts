// Server-side validation of a customer's item selection against the live menu.
// Prices ALWAYS come from the menu snapshot here, never from the browser.

export interface MenuOptionSnapshot {
  id: string;
  name: string;
  priceDeltaMinor: number;
  isAvailable: boolean;
}

export interface MenuGroupSnapshot {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: MenuOptionSnapshot[];
}

export interface MenuVariantSnapshot {
  id: string;
  name: string;
  priceMinor: number;
  isAvailable: boolean;
}

export interface MenuItemSnapshot {
  id: string;
  name: string;
  categoryName: string;
  basePriceMinor: number;
  /** false when unavailable globally, at the branch, or not offered at the branch. */
  orderable: boolean;
  allergens: string | null;
  variants: MenuVariantSnapshot[];
  groups: MenuGroupSnapshot[];
}

export interface CartLineInput {
  menuItemId: string;
  variantId?: string | null;
  optionIds: string[];
  quantity: number;
  note?: string | null;
}

export interface ResolvedLine {
  menuItemId: string;
  variantId: string | null;
  name: string;
  variantName: string | null;
  categoryName: string;
  allergens: string | null;
  unitPriceMinor: number;
  modifiersUnitMinor: number;
  quantity: number;
  lineTotalMinor: number;
  note: string | null;
  modifiers: { optionId: string; groupName: string; name: string; priceDeltaMinor: number }[];
}

export type LineError =
  | { code: "ITEM_NOT_FOUND" }
  | { code: "ITEM_UNAVAILABLE"; name: string }
  | { code: "VARIANT_REQUIRED"; name: string }
  | { code: "VARIANT_INVALID"; name: string }
  | { code: "VARIANT_UNAVAILABLE"; name: string; variant: string }
  | { code: "OPTION_INVALID"; name: string }
  | { code: "OPTION_UNAVAILABLE"; name: string; option: string }
  | { code: "OPTION_DUPLICATE"; name: string }
  | { code: "GROUP_MIN"; name: string; group: string; min: number }
  | { code: "GROUP_MAX"; name: string; group: string; max: number }
  | { code: "QUANTITY_INVALID"; name: string; max: number };

export function describeLineError(e: LineError): string {
  switch (e.code) {
    case "ITEM_NOT_FOUND":
      return "One of the items in your order is no longer on the menu.";
    case "ITEM_UNAVAILABLE":
      return `${e.name} is not available right now.`;
    case "VARIANT_REQUIRED":
      return `Please choose an option for ${e.name}.`;
    case "VARIANT_INVALID":
      return `The selected option for ${e.name} is no longer offered.`;
    case "VARIANT_UNAVAILABLE":
      return `${e.name} (${e.variant}) is not available right now.`;
    case "OPTION_INVALID":
      return `One of the extras chosen for ${e.name} is no longer offered.`;
    case "OPTION_UNAVAILABLE":
      return `${e.option} is not available for ${e.name} right now.`;
    case "OPTION_DUPLICATE":
      return `An extra was selected twice for ${e.name}.`;
    case "GROUP_MIN":
      return `${e.name}: choose at least ${e.min} for “${e.group}”.`;
    case "GROUP_MAX":
      return `${e.name}: choose at most ${e.max} for “${e.group}”.`;
    case "QUANTITY_INVALID":
      return `${e.name}: quantity must be between 1 and ${e.max}.`;
  }
}

export function resolveCartLine(
  line: CartLineInput,
  item: MenuItemSnapshot | undefined,
  maxQuantity: number,
): { ok: true; line: ResolvedLine } | { ok: false; error: LineError } {
  if (!item) return { ok: false, error: { code: "ITEM_NOT_FOUND" } };
  if (!item.orderable) return { ok: false, error: { code: "ITEM_UNAVAILABLE", name: item.name } };
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > maxQuantity) {
    return { ok: false, error: { code: "QUANTITY_INVALID", name: item.name, max: maxQuantity } };
  }

  let unitPriceMinor = item.basePriceMinor;
  let variant: MenuVariantSnapshot | null = null;
  if (item.variants.length > 0) {
    if (!line.variantId) return { ok: false, error: { code: "VARIANT_REQUIRED", name: item.name } };
    variant = item.variants.find((v) => v.id === line.variantId) ?? null;
    if (!variant) return { ok: false, error: { code: "VARIANT_INVALID", name: item.name } };
    if (!variant.isAvailable)
      return { ok: false, error: { code: "VARIANT_UNAVAILABLE", name: item.name, variant: variant.name } };
    unitPriceMinor = variant.priceMinor;
  } else if (line.variantId) {
    return { ok: false, error: { code: "VARIANT_INVALID", name: item.name } };
  }

  const selected = new Set(line.optionIds);
  if (selected.size !== line.optionIds.length)
    return { ok: false, error: { code: "OPTION_DUPLICATE", name: item.name } };

  const optionIndex = new Map<string, { group: MenuGroupSnapshot; option: MenuOptionSnapshot }>();
  for (const group of item.groups) for (const option of group.options) optionIndex.set(option.id, { group, option });

  for (const id of selected) {
    const hit = optionIndex.get(id);
    if (!hit) return { ok: false, error: { code: "OPTION_INVALID", name: item.name } };
    if (!hit.option.isAvailable)
      return { ok: false, error: { code: "OPTION_UNAVAILABLE", name: item.name, option: hit.option.name } };
  }

  const modifiers: ResolvedLine["modifiers"] = [];
  for (const group of item.groups) {
    const chosen = group.options.filter((o) => selected.has(o.id));
    if (chosen.length < group.minSelect)
      return { ok: false, error: { code: "GROUP_MIN", name: item.name, group: group.name, min: group.minSelect } };
    if (chosen.length > group.maxSelect)
      return { ok: false, error: { code: "GROUP_MAX", name: item.name, group: group.name, max: group.maxSelect } };
    for (const o of chosen)
      modifiers.push({ optionId: o.id, groupName: group.name, name: o.name, priceDeltaMinor: o.priceDeltaMinor });
  }

  const modifiersUnitMinor = modifiers.reduce((a, m) => a + m.priceDeltaMinor, 0);
  const note = line.note?.trim() ? line.note.trim().slice(0, 280) : null;
  return {
    ok: true,
    line: {
      menuItemId: item.id,
      variantId: variant?.id ?? null,
      name: item.name,
      variantName: variant?.name ?? null,
      categoryName: item.categoryName,
      allergens: item.allergens,
      unitPriceMinor,
      modifiersUnitMinor,
      quantity: line.quantity,
      lineTotalMinor: (unitPriceMinor + modifiersUnitMinor) * line.quantity,
      note,
      modifiers,
    },
  };
}
