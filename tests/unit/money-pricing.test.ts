import { describe, expect, it } from "vitest";
import { applyBps, currencyExponent, formatMoney, parseMoneyInput, toMajorInput } from "@/domain/money";
import { computeOrderTotals, lineTotal, type PricingSettings } from "@/domain/pricing";

const NO_CHARGES: PricingSettings = {
  taxEnabled: false,
  taxRateBps: 0,
  taxInclusive: true,
  serviceChargeEnabled: false,
  serviceChargeBps: 0,
};

describe("money", () => {
  it("knows currency minor units", () => {
    expect(currencyExponent("UGX")).toBe(0);
    expect(currencyExponent("KES")).toBe(2);
    expect(currencyExponent("ugx")).toBe(0);
  });

  it("formats UGX without decimals", () => {
    expect(formatMoney(25_000, "UGX", "en-UG")).toMatch(/25,000/);
    expect(formatMoney(25_000, "UGX", "en-UG")).not.toMatch(/\./);
  });

  it("parses user input to minor units without floating point errors", () => {
    expect(parseMoneyInput("25,000", "UGX")).toBe(25_000);
    expect(parseMoneyInput("25000.00", "UGX")).toBe(25_000);
    expect(parseMoneyInput("250.50", "KES")).toBe(25_050);
    expect(parseMoneyInput("0.1", "KES")).toBe(10);
    expect(parseMoneyInput("19.99", "USD")).toBe(1_999);
  });

  it("rejects invalid or over-precise input", () => {
    expect(parseMoneyInput("abc", "UGX")).toBeNull();
    expect(parseMoneyInput("-5", "UGX")).toBeNull();
    expect(parseMoneyInput("250.5", "UGX")).toBeNull();
    expect(parseMoneyInput("1.234", "KES")).toBeNull();
    expect(parseMoneyInput("", "UGX")).toBeNull();
  });

  it("round-trips editable values", () => {
    expect(toMajorInput(25_000, "UGX")).toBe("25000");
    expect(toMajorInput(25_050, "KES")).toBe("250.50");
  });

  it("applies basis points with half-up rounding", () => {
    expect(applyBps(10_000, 1_000)).toBe(1_000); // 10%
    expect(applyBps(25, 1_000)).toBe(3); // 2.5 → 3
    expect(applyBps(24, 1_000)).toBe(2); // 2.4 → 2
    expect(applyBps(0, 1_800)).toBe(0);
    expect(() => applyBps(-1, 100)).toThrow();
  });
});

describe("pricing", () => {
  it("computes line totals from unit price, modifiers and quantity", () => {
    expect(lineTotal(35_000, 2_000, 2)).toBe(74_000);
    expect(() => lineTotal(1_000, 0, 0)).toThrow();
    expect(() => lineTotal(1_000, 0, 1.5)).toThrow();
  });

  it("sums lines with no charges", () => {
    expect(computeOrderTotals([10_000, 5_000], NO_CHARGES)).toEqual({
      subtotalMinor: 15_000,
      serviceChargeMinor: 0,
      taxMinor: 0,
      taxIncludedMinor: 0,
      totalMinor: 15_000,
    });
  });

  it("adds a service charge", () => {
    const t = computeOrderTotals([15_000], { ...NO_CHARGES, serviceChargeEnabled: true, serviceChargeBps: 1_000 });
    expect(t.serviceChargeMinor).toBe(1_500);
    expect(t.totalMinor).toBe(16_500);
  });

  it("adds exclusive tax on subtotal plus service charge", () => {
    const t = computeOrderTotals([10_000], {
      taxEnabled: true,
      taxRateBps: 1_800,
      taxInclusive: false,
      serviceChargeEnabled: true,
      serviceChargeBps: 1_000,
    });
    expect(t.serviceChargeMinor).toBe(1_000);
    expect(t.taxMinor).toBe(1_980); // 18% of 11,000
    expect(t.totalMinor).toBe(12_980);
    expect(t.taxIncludedMinor).toBe(0);
  });

  it("reports inclusive tax without changing the total", () => {
    const t = computeOrderTotals([11_800], { ...NO_CHARGES, taxEnabled: true, taxRateBps: 1_800, taxInclusive: true });
    expect(t.totalMinor).toBe(11_800);
    expect(t.taxMinor).toBe(0);
    expect(t.taxIncludedMinor).toBe(1_800); // 11,800 × 18/118
  });

  it("ignores tax when disabled even if a rate is stored", () => {
    const t = computeOrderTotals([10_000], {
      ...NO_CHARGES,
      taxEnabled: false,
      taxRateBps: 1_800,
      taxInclusive: false,
    });
    expect(t.totalMinor).toBe(10_000);
  });

  it("always keeps total = subtotal + service charge + added tax", () => {
    for (const lines of [[1], [333, 333, 334], [99_999, 1], [25_000, 7_000, 3_000]]) {
      for (const inclusive of [true, false]) {
        const t = computeOrderTotals(lines, {
          taxEnabled: true,
          taxRateBps: 1_750,
          taxInclusive: inclusive,
          serviceChargeEnabled: true,
          serviceChargeBps: 750,
        });
        expect(t.totalMinor).toBe(t.subtotalMinor + t.serviceChargeMinor + t.taxMinor);
        expect(Number.isInteger(t.totalMinor)).toBe(true);
      }
    }
  });
});
