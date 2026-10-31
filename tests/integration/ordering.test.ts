import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createServiceRequest, getPublicMenu, getPublicOrder, placeOrder, resolveQr } from "@/server/services/ordering";
import { setBranchItemOverride, setMenuItemAvailable, updateMenuItem } from "@/server/services/menu";
import { regenerateTableQr, revokeTableQr } from "@/server/services/tables";
import { setCategoryRoute, createStation } from "@/server/services/restaurant";
import { makeRestaurant, sampleCart, SAMPLE_CART_TOTAL, type TestRestaurant } from "../helpers/fixtures";

let r: TestRestaurant;
beforeAll(async () => {
  r = await makeRestaurant({ name: "Ordering Test Grill" });
});

describe("QR resolution", () => {
  it("resolves a valid token to its tenant, branch and table", async () => {
    const res = await resolveQr(r.qrToken);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.tenant.id).toBe(r.tenantId);
    expect(res.data.branch.id).toBe(r.branchId);
    expect(res.data.table.id).toBe(r.tableId);
  });

  it("rejects malformed and unknown tokens", async () => {
    expect((await resolveQr("short")).ok).toBe(false);
    expect((await resolveQr("A".repeat(24))).ok).toBe(false);
  });

  it("returns the public menu with availability", async () => {
    const menu = await getPublicMenu(r.tenantId, r.branchId);
    const names = menu.flatMap((c) => c.items.map((i) => i.name));
    expect(names).toEqual(expect.arrayContaining(["Burger", "Soda"]));
    // Internal prep notes are never part of the public menu payload.
    expect(JSON.stringify(menu)).not.toContain("prepNotes");
  });
});

describe("placing orders", () => {
  it("creates an order with server-computed prices, snapshots and a kitchen ticket", async () => {
    const res = await placeOrder(sampleCart(r));
    expect(res.duplicate).toBe(false);
    expect(res.totalMinor).toBe(SAMPLE_CART_TOTAL);
    const order = await db.order.findUniqueOrThrow({
      where: { publicToken: res.publicToken },
      include: { items: { include: { modifiers: true } }, tickets: true, statusHistory: true },
    });
    expect(order.status).toBe("PLACED");
    expect(order.paymentStatus).toBe("UNPAID");
    expect(order.tenantId).toBe(r.tenantId);
    expect(order.branchId).toBe(r.branchId);
    expect(order.tableLabel).toBe("T1");
    const burger = order.items.find((i) => i.nameSnapshot === "Burger")!;
    expect(burger.variantNameSnapshot).toBe("Large");
    expect(burger.unitPriceMinor).toBe(26_000);
    expect(burger.modifiersUnitMinor).toBe(3_500);
    expect(burger.note).toBe("No onions");
    expect(burger.allergensSnapshot).toBe("Gluten");
    expect(burger.modifiers.map((m) => m.nameSnapshot).sort()).toEqual(["Cheese", "Salad"]);
    expect(order.tickets).toHaveLength(1);
    expect(order.statusHistory[0]).toMatchObject({ toStatus: "PLACED", actorType: "CUSTOMER" });
  });

  it("is idempotent: resubmitting the same cart returns the same order", async () => {
    const cart = sampleCart(r);
    const a = await placeOrder(cart);
    const b = await placeOrder(cart);
    expect(b.duplicate).toBe(true);
    expect(b.reference).toBe(a.reference);
    expect(await db.order.count({ where: { tenantId: r.tenantId, idempotencyKey: cart.idempotencyKey } })).toBe(1);
  });

  it("creates exactly one order for concurrent double submissions", async () => {
    const cart = sampleCart(r);
    const results = await Promise.all([placeOrder(cart), placeOrder(cart), placeOrder(cart)]);
    expect(new Set(results.map((x) => x.reference)).size).toBe(1);
    expect(await db.order.count({ where: { tenantId: r.tenantId, idempotencyKey: cart.idempotencyKey } })).toBe(1);
  });

  it("gives every order a unique reference under concurrency", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => placeOrder(sampleCart(r, r.table2Token))));
    expect(new Set(results.map((x) => x.reference)).size).toBe(8);
  });

  it("puts several customers at one table into the same session with separate orders", async () => {
    const before = await db.tableSession.findMany({ where: { tableId: r.tableId, status: "OPEN" } });
    const a = await placeOrder(sampleCart(r));
    const b = await placeOrder(sampleCart(r));
    const orders = await db.order.findMany({ where: { publicToken: { in: [a.publicToken, b.publicToken] } } });
    expect(orders).toHaveLength(2);
    expect(orders[0].tableSessionId).toBe(orders[1].tableSessionId);
    const open = await db.tableSession.findMany({ where: { tableId: r.tableId, status: "OPEN" } });
    expect(open).toHaveLength(1);
    if (before[0]) expect(open[0].id).toBe(before[0].id);
  });

  it("expires an idle session and opens a new one", async () => {
    const session = await db.tableSession.findFirstOrThrow({ where: { tableId: r.tableId, status: "OPEN" } });
    await db.tableSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date(Date.now() - 6 * 3600_000) },
    });
    const res = await placeOrder(sampleCart(r));
    const order = await db.order.findUniqueOrThrow({ where: { publicToken: res.publicToken } });
    expect(order.tableSessionId).not.toBe(session.id);
    expect((await db.tableSession.findUniqueOrThrow({ where: { id: session.id } })).status).toBe("EXPIRED");
  });

  it("rejects items that became unavailable, with a clear message", async () => {
    await setMenuItemAvailable(r.owner, { itemId: r.items.sodaId, available: false });
    await expect(placeOrder(sampleCart(r))).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Soda is not available right now.",
    });
    await setMenuItemAvailable(r.owner, { itemId: r.items.sodaId, available: true });
  });

  it("respects branch-level overrides", async () => {
    await setBranchItemOverride(r.owner, { itemId: r.items.sodaId, branchId: r.branchId, isAvailable: false });
    await expect(placeOrder(sampleCart(r))).rejects.toMatchObject({ code: "VALIDATION" });
    await setBranchItemOverride(r.owner, {
      itemId: r.items.sodaId,
      branchId: r.branchId,
      isAvailable: true,
      isOffered: false,
    });
    await expect(placeOrder(sampleCart(r))).rejects.toMatchObject({ code: "VALIDATION" });
    const menu = await getPublicMenu(r.tenantId, r.branchId);
    expect(menu.flatMap((c) => c.items.map((i) => i.name))).not.toContain("Soda");
    await setBranchItemOverride(r.owner, {
      itemId: r.items.sodaId,
      branchId: r.branchId,
      isAvailable: true,
      isOffered: true,
    });
  });

  it("rejects invalid modifier selections and quantities", async () => {
    const cart = sampleCart(r);
    cart.lines[0].optionIds = []; // required side missing
    await expect(placeOrder(cart)).rejects.toMatchObject({ code: "VALIDATION" });
    const cart2 = sampleCart(r);
    cart2.lines[1].quantity = 0;
    await expect(placeOrder(cart2)).rejects.toThrow();
    const cart3 = sampleCart(r);
    cart3.lines[1].quantity = 999;
    await expect(placeOrder(cart3)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps old orders unchanged when the menu is edited", async () => {
    const res = await placeOrder(sampleCart(r));
    const drinks = await db.menuCategory.findFirstOrThrow({ where: { tenantId: r.tenantId, name: "Drinks" } });
    await updateMenuItem(r.owner, {
      itemId: r.items.sodaId,
      categoryId: drinks.id,
      name: "Fizzy drink",
      basePriceMinor: 9_999,
    });
    const order = await db.order.findUniqueOrThrow({
      where: { publicToken: res.publicToken },
      include: { items: true },
    });
    const soda = order.items.find((i) => i.menuItemId === r.items.sodaId)!;
    expect(soda.nameSnapshot).toBe("Soda");
    expect(soda.unitPriceMinor).toBe(3_000);
    expect(order.totalMinor).toBe(SAMPLE_CART_TOTAL);
    await updateMenuItem(r.owner, {
      itemId: r.items.sodaId,
      categoryId: drinks.id,
      name: "Soda",
      basePriceMinor: 3_000,
    });
  });

  it("exposes order progress only through the unguessable public token", async () => {
    const res = await placeOrder(sampleCart(r));
    const pub = await getPublicOrder(res.publicToken);
    expect(pub?.reference).toBe(res.reference);
    expect(pub?.totalMinor).toBe(SAMPLE_CART_TOTAL);
    expect(await getPublicOrder(res.reference)).toBeNull();
    expect(await getPublicOrder("x".repeat(32))).toBeNull();
  });
});

describe("QR revocation", () => {
  it("stops a revoked token immediately and the replacement works", async () => {
    const r2 = await makeRestaurant();
    const old = r2.qrToken;
    const fresh = await regenerateTableQr(r2.owner, { tableId: r2.tableId });
    expect(fresh.token).not.toBe(old);
    await expect(placeOrder(sampleCart(r2, old))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(placeOrder(sampleCart(r2, fresh.token))).resolves.toMatchObject({ duplicate: false });
    await revokeTableQr(r2.owner, { tableId: r2.tableId });
    await expect(placeOrder(sampleCart(r2, fresh.token))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.tableQrToken.count({ where: { tableId: r2.tableId, status: "ACTIVE" } })).toBe(0);
  });

  it("does not accept orders for restaurants that are not live", async () => {
    const r3 = await makeRestaurant({ activate: false });
    await expect(placeOrder(sampleCart(r3))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    expect(await resolveQr(r3.qrToken)).toEqual({ ok: false, reason: "closed" });
  });
});

describe("kitchen routing and printing", () => {
  it("splits an order into one ticket per station following routing rules", async () => {
    const r4 = await makeRestaurant();
    const bar = await createStation(r4.owner, { branchId: r4.branchId, name: "Bar" });
    const drinks = await db.menuCategory.findFirstOrThrow({ where: { tenantId: r4.tenantId, name: "Drinks" } });
    await setCategoryRoute(r4.owner, { branchId: r4.branchId, categoryId: drinks.id, stationId: bar.id });
    const res = await placeOrder(sampleCart(r4));
    const order = await db.order.findUniqueOrThrow({
      where: { publicToken: res.publicToken },
      include: { tickets: { include: { station: true, items: true } } },
    });
    expect(order.tickets).toHaveLength(2);
    const barTicket = order.tickets.find((t) => t.stationId === bar.id)!;
    expect(barTicket.items.map((i) => i.nameSnapshot)).toEqual(["Soda"]);
  });

  it("queues one print job per ticket and printer in printer modes", async () => {
    const r5 = await makeRestaurant({ mode: "DIGITAL_AND_PRINTER" });
    await db.printerConfiguration.create({
      data: { tenantId: r5.tenantId, branchId: r5.branchId, name: "P1", connection: "BROWSER" },
    });
    const res = await placeOrder(sampleCart(r5));
    const order = await db.order.findUniqueOrThrow({
      where: { publicToken: res.publicToken },
      include: { tickets: { include: { printJobs: true } } },
    });
    expect(order.tickets[0].printJobs).toHaveLength(1);
    expect(order.tickets[0].printJobs[0].status).toBe("PENDING");
  });
});

describe("service requests", () => {
  it("creates a waiter call and reuses an identical open request", async () => {
    const a = await createServiceRequest({ token: r.qrToken, type: "ASSISTANCE" });
    const b = await createServiceRequest({ token: r.qrToken, type: "ASSISTANCE" });
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(await db.serviceRequest.count({ where: { tableId: r.tableId, type: "ASSISTANCE", status: "OPEN" } })).toBe(
      1,
    );
  });

  it("respects the bill-request switch", async () => {
    await db.restaurantSettings.update({ where: { tenantId: r.tenantId }, data: { enableBillRequests: false } });
    await expect(createServiceRequest({ token: r.qrToken, type: "BILL" })).rejects.toMatchObject({
      code: "UNAVAILABLE",
    });
    await db.restaurantSettings.update({ where: { tenantId: r.tenantId }, data: { enableBillRequests: true } });
    await expect(
      createServiceRequest({ token: r.qrToken, type: "BILL", note: "Split in two please" }),
    ).resolves.toMatchObject({ type: "BILL" });
  });

  it("rejects invalid tokens", async () => {
    await expect(
      createServiceRequest({ token: randomUUID().replace(/-/g, ""), type: "ASSISTANCE" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
