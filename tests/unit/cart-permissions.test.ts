import { describe, expect, it } from "vitest";
import { resolveCartLine, type MenuItemSnapshot } from "@/domain/cart";
import {
  assignableRoles,
  platformRoleHasPermission,
  roleCanProgressKitchen,
  roleHasPermission,
} from "@/domain/permissions";
import { charsPerLine, formatTicketText } from "@/domain/ticket-format";
import { isWellFormedToken, randomToken } from "@/server/tokens";

const ITEM: MenuItemSnapshot = {
  id: "item1",
  name: "Nyama choma",
  categoryName: "Grills",
  basePriceMinor: 30_000,
  orderable: true,
  allergens: null,
  variants: [
    { id: "half", name: "Half kg", priceMinor: 35_000, isAvailable: true },
    { id: "kilo", name: "1 kg", priceMinor: 65_000, isAvailable: false },
  ],
  groups: [
    {
      id: "side",
      name: "Side",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { id: "chips", name: "Chips", priceDeltaMinor: 0, isAvailable: true },
        { id: "gonja", name: "Gonja", priceDeltaMinor: 2_000, isAvailable: true },
        { id: "rice", name: "Rice", priceDeltaMinor: 0, isAvailable: false },
      ],
    },
    {
      id: "extras",
      name: "Extras",
      minSelect: 0,
      maxSelect: 2,
      options: [
        { id: "avo", name: "Avocado", priceDeltaMinor: 3_000, isAvailable: true },
        { id: "kach", name: "Kachumbari", priceDeltaMinor: 2_000, isAvailable: true },
        { id: "chilli", name: "Chilli", priceDeltaMinor: 0, isAvailable: true },
      ],
    },
  ],
};

const base = { menuItemId: "item1", variantId: "half", optionIds: ["gonja"], quantity: 2 };

describe("cart line validation", () => {
  it("prices from the menu, including variant and modifiers", () => {
    const r = resolveCartLine({ ...base, optionIds: ["gonja", "avo"] }, ITEM, 20);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line.unitPriceMinor).toBe(35_000);
    expect(r.line.modifiersUnitMinor).toBe(5_000);
    expect(r.line.lineTotalMinor).toBe(80_000);
    expect(r.line.modifiers.map((m) => m.name)).toEqual(["Gonja", "Avocado"]);
  });

  it("requires a variant when the item has variants", () => {
    const r = resolveCartLine({ ...base, variantId: null }, ITEM, 20);
    expect(r.ok || r.error.code).toBe("VARIANT_REQUIRED");
  });

  it("rejects unknown and unavailable variants", () => {
    expect((resolveCartLine({ ...base, variantId: "nope" }, ITEM, 20) as { error: { code: string } }).error.code).toBe(
      "VARIANT_INVALID",
    );
    expect((resolveCartLine({ ...base, variantId: "kilo" }, ITEM, 20) as { error: { code: string } }).error.code).toBe(
      "VARIANT_UNAVAILABLE",
    );
  });

  it("enforces required groups (min) and max selections", () => {
    expect((resolveCartLine({ ...base, optionIds: [] }, ITEM, 20) as { error: { code: string } }).error.code).toBe(
      "GROUP_MIN",
    );
    expect(
      (resolveCartLine({ ...base, optionIds: ["chips", "gonja"] }, ITEM, 20) as { error: { code: string } }).error.code,
    ).toBe("GROUP_MAX");
    expect(
      (
        resolveCartLine({ ...base, optionIds: ["chips", "avo", "kach", "chilli"] }, ITEM, 20) as {
          error: { code: string };
        }
      ).error.code,
    ).toBe("GROUP_MAX");
  });

  it("rejects options from other items, unavailable options and duplicates", () => {
    expect(
      (resolveCartLine({ ...base, optionIds: ["chips", "foreign"] }, ITEM, 20) as { error: { code: string } }).error
        .code,
    ).toBe("OPTION_INVALID");
    expect(
      (resolveCartLine({ ...base, optionIds: ["rice"] }, ITEM, 20) as { error: { code: string } }).error.code,
    ).toBe("OPTION_UNAVAILABLE");
    expect(
      (resolveCartLine({ ...base, optionIds: ["chips", "chips"] }, ITEM, 20) as { error: { code: string } }).error.code,
    ).toBe("OPTION_DUPLICATE");
  });

  it("rejects bad quantities and unavailable or missing items", () => {
    for (const q of [0, -1, 1.5, 21]) {
      expect((resolveCartLine({ ...base, quantity: q }, ITEM, 20) as { error: { code: string } }).error.code).toBe(
        "QUANTITY_INVALID",
      );
    }
    expect((resolveCartLine(base, { ...ITEM, orderable: false }, 20) as { error: { code: string } }).error.code).toBe(
      "ITEM_UNAVAILABLE",
    );
    expect((resolveCartLine(base, undefined, 20) as { error: { code: string } }).error.code).toBe("ITEM_NOT_FOUND");
  });

  it("ignores any client price because the input type has none", () => {
    const tampered = { ...base, priceMinor: 1, unitPriceMinor: 1 } as typeof base;
    const r = resolveCartLine(tampered, ITEM, 20);
    expect(r.ok && r.line.unitPriceMinor).toBe(35_000);
  });
});

describe("permissions", () => {
  it("keeps kitchen staff away from money and administration", () => {
    expect(roleHasPermission("KITCHEN", "orders.kitchen")).toBe(true);
    expect(roleHasPermission("KITCHEN", "payments.view")).toBe(false);
    expect(roleHasPermission("KITCHEN", "reports.view")).toBe(false);
    expect(roleHasPermission("KITCHEN", "menu.manage")).toBe(false);
    expect(roleHasPermission("KITCHEN", "staff.manage")).toBe(false);
  });

  it("lets waiters serve and record payments but not void or administer", () => {
    expect(roleHasPermission("WAITER", "orders.serve")).toBe(true);
    expect(roleHasPermission("WAITER", "payments.record")).toBe(true);
    expect(roleHasPermission("WAITER", "payments.void")).toBe(false);
    expect(roleHasPermission("WAITER", "tenant.billing.view")).toBe(false);
    expect(roleHasPermission("WAITER", "reports.view")).toBe(false);
  });

  it("only owners see billing and audit", () => {
    expect(roleHasPermission("RESTAURANT_OWNER", "tenant.billing.view")).toBe(true);
    expect(roleHasPermission("MANAGER", "tenant.billing.view")).toBe(false);
    expect(roleHasPermission("MANAGER", "tenant.audit.view")).toBe(false);
  });

  it("allows waiters to progress kitchen tickets only without a kitchen screen", () => {
    expect(roleCanProgressKitchen("WAITER", "DIGITAL_DISPLAY")).toBe(false);
    expect(roleCanProgressKitchen("WAITER", "DIGITAL_AND_PRINTER")).toBe(false);
    expect(roleCanProgressKitchen("WAITER", "PRINTER")).toBe(true);
    expect(roleCanProgressKitchen("WAITER", "MANUAL")).toBe(true);
    expect(roleCanProgressKitchen("KITCHEN", "DIGITAL_DISPLAY")).toBe(true);
  });

  it("limits which roles can be assigned", () => {
    expect(assignableRoles("RESTAURANT_OWNER")).not.toContain("RESTAURANT_OWNER");
    expect(assignableRoles("MANAGER")).toEqual(["WAITER", "KITCHEN"]);
    expect(assignableRoles("WAITER")).toEqual([]);
  });

  it("separates platform roles", () => {
    expect(platformRoleHasPermission("SUPER_ADMIN", "platform.tenants.manage")).toBe(true);
    expect(platformRoleHasPermission("PLATFORM_BILLING", "platform.tenants.manage")).toBe(false);
    expect(platformRoleHasPermission("PLATFORM_BILLING", "platform.billing.manage")).toBe(true);
    expect(platformRoleHasPermission("PLATFORM_SUPPORT", "platform.billing.manage")).toBe(false);
    expect(platformRoleHasPermission(null, "platform.tenants.view")).toBe(false);
  });
});

describe("QR tokens", () => {
  it("are long, random and URL-safe", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => randomToken()));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) {
      expect(t).toMatch(/^[A-Za-z0-9_-]{24}$/);
      expect(isWellFormedToken(t)).toBe(true);
    }
  });

  it("rejects malformed tokens before any lookup", () => {
    for (const bad of ["", "1", "abc", "../../etc/passwd", "a".repeat(65), "x' OR 1=1 --", "12345678901234567890 "]) {
      expect(isWellFormedToken(bad)).toBe(false);
    }
  });
});

describe("kitchen ticket text", () => {
  const ticket = {
    reference: "0042",
    tableLabel: "7",
    stationName: "Grill",
    branchName: "Kololo",
    restaurantName: "Kampala Grill",
    placedAt: "19 Oct 2026, 13:05",
    customerName: null,
    customerNote: "Birthday — bring candles",
    items: [
      {
        quantity: 2,
        name: "Nyama choma (goat)",
        variant: "1 kg",
        modifiers: ["Gonja", "Avocado"],
        note: "Well done please",
        allergens: null,
      },
      { quantity: 1, name: "Chicken luwombo", variant: null, modifiers: [], note: null, allergens: "Peanuts" },
    ],
  };

  it("fits the paper width", () => {
    for (const width of [58, 80]) {
      const text = formatTicketText(ticket, width);
      for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(charsPerLine(width));
    }
  });

  it("shows quantities, modifiers, notes and allergy warnings", () => {
    const text = formatTicketText(ticket, 80);
    expect(text).toContain("2 x Nyama choma (goat) (1 kg)");
    expect(text).toContain("+ Gonja");
    expect(text).toContain("NOTE: Well done please");
    expect(text).toContain("!! ALLERGY: Peanuts");
    expect(text).toContain("TABLE 7");
    expect(text).toContain("ORDER #0042");
  });

  it("marks reprints", () => {
    expect(formatTicketText({ ...ticket, reprint: true }, 58)).toContain("REPRINT");
  });
});
