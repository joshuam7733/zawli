// SECURITY: tenant and branch isolation. Restaurant A must never read or change
// Restaurant B's data by passing B's identifiers to A's authorised context.
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { loadTenantContext } from "@/server/authz";
import { placeOrder, getPublicMenu } from "@/server/services/ordering";
import {
  createMenuItem,
  getMenuItemAdmin,
  saveVariants,
  setBranchItemOverride,
  setItemModifierGroups,
  setMenuItemAvailable,
  updateCategory,
  updateMenuItem,
} from "@/server/services/menu";
import {
  advanceTicket,
  cancelOrder,
  getKitchenBoard,
  getOrderDetail,
  listOrders,
  markOrderServing,
} from "@/server/services/orders";
import { recordPayment, voidPayment, getSessionBill } from "@/server/services/payments";
import { createTable, regenerateTableQr, updateTable, listTables, getQrSheet } from "@/server/services/tables";
import { inviteStaff, listStaff, setStaffActive, updateStaff } from "@/server/services/staff";
import { getFloorBoard, updateServiceRequest } from "@/server/services/floor";
import { getDashboard, getTenantAudit, exportOrdersCsv } from "@/server/services/reports";
import {
  getTenantBilling,
  getTenantInvoice,
  createInvoice,
  changeSubscription,
  listInvoices,
} from "@/server/services/billing";
import { createTenant, setTenantStatus, listTenants } from "@/server/services/platform-tenants";
import { getTicketForPrint, markPrintJob } from "@/server/services/printing";
import { createServiceRequest } from "@/server/services/ordering";
import { makeRestaurant, makeUser, ensurePlan, sampleCart, type TestRestaurant } from "../helpers/fixtures";

let A: TestRestaurant;
let B: TestRestaurant;
let bOrderId: string;
let bTicketId: string;
let bPaymentId: string;
let bSessionId: string;
let bRequestId: string;
let bCategoryId: string;

beforeAll(async () => {
  A = await makeRestaurant({ name: "Restaurant A" });
  B = await makeRestaurant({ name: "Restaurant B", mode: "DIGITAL_AND_PRINTER" });
  const res = await placeOrder(sampleCart(B));
  const order = await db.order.findUniqueOrThrow({
    where: { publicToken: res.publicToken },
    include: { tickets: true },
  });
  bOrderId = order.id;
  bTicketId = order.tickets[0].id;
  bSessionId = order.tableSessionId!;
  bPaymentId = (await recordPayment(B.owner, { orderId: order.id, amountMinor: 1_000, method: "CASH" })).paymentId;
  await createServiceRequest({ token: B.qrToken, type: "ASSISTANCE" });
  bRequestId = (await db.serviceRequest.findFirstOrThrow({ where: { tenantId: B.tenantId } })).id;
  bCategoryId = (await db.menuCategory.findFirstOrThrow({ where: { tenantId: B.tenantId } })).id;
});

const NOT_VISIBLE = { code: expect.stringMatching(/NOT_FOUND|FORBIDDEN/) };

describe("Restaurant A cannot access Restaurant B's menu administration", () => {
  it("cannot read B's menu items", async () => {
    await expect(getMenuItemAdmin(A.owner, B.items.burgerId)).rejects.toMatchObject(NOT_VISIBLE);
  });

  it("cannot modify B's prices", async () => {
    await expect(
      updateMenuItem(A.owner, { itemId: B.items.sodaId, categoryId: bCategoryId, name: "Hacked", basePriceMinor: 1 }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    const soda = await db.menuItem.findUniqueOrThrow({ where: { id: B.items.sodaId } });
    expect(soda.basePriceMinor).toBe(3_000);
    expect(soda.name).toBe("Soda");
  });

  it("cannot create items in B's category or move its own items there", async () => {
    await expect(
      createMenuItem(A.owner, { categoryId: bCategoryId, name: "x", basePriceMinor: 1 }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    await expect(
      updateMenuItem(A.owner, { itemId: A.items.sodaId, categoryId: bCategoryId, name: "Soda", basePriceMinor: 3_000 }),
    ).rejects.toMatchObject(NOT_VISIBLE);
  });

  it("cannot toggle B's availability, variants, modifiers, categories or branch overrides", async () => {
    await expect(setMenuItemAvailable(A.owner, { itemId: B.items.sodaId, available: false })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(saveVariants(A.owner, { itemId: B.items.burgerId, variants: [] })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(updateCategory(A.owner, { categoryId: bCategoryId, name: "Hacked" })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(
      setBranchItemOverride(A.owner, { itemId: B.items.sodaId, branchId: B.branchId, isAvailable: false }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    await expect(
      setBranchItemOverride(A.owner, { itemId: A.items.sodaId, branchId: B.branchId, isAvailable: false }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    const bGroup = await db.modifierGroup.findFirstOrThrow({ where: { tenantId: B.tenantId } });
    await expect(
      setItemModifierGroups(A.owner, { itemId: A.items.burgerId, groupIds: [bGroup.id] }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    expect((await db.menuItem.findUniqueOrThrow({ where: { id: B.items.sodaId } })).isAvailable).toBe(true);
  });
});

describe("Restaurant A cannot read or change Restaurant B's orders", () => {
  it("cannot read B's order detail or see it in lists", async () => {
    await expect(getOrderDetail(A.owner, bOrderId)).rejects.toMatchObject(NOT_VISIBLE);
    const listed = await listOrders(A.owner, { scope: "all" });
    expect(listed.some((o) => o.id === bOrderId)).toBe(false);
    const listedWithBBranch = await listOrders(A.owner, { scope: "all", branchId: B.branchId });
    expect(listedWithBBranch).toEqual([]);
  });

  it("cannot see B's kitchen or floor boards", async () => {
    await expect(getKitchenBoard(A.owner, { branchId: B.branchId })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(getFloorBoard(A.owner, B.branchId)).rejects.toMatchObject(NOT_VISIBLE);
    await expect(getTicketForPrint(A.owner, bTicketId)).rejects.toMatchObject(NOT_VISIBLE);
  });

  it("cannot transition, serve or cancel B's orders", async () => {
    await expect(advanceTicket(A.kitchen, { ticketId: bTicketId, to: "ACKNOWLEDGED" })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(advanceTicket(A.owner, { ticketId: bTicketId, to: "ACKNOWLEDGED" })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(markOrderServing(A.owner, { orderId: bOrderId, to: "SERVED" })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(cancelOrder(A.owner, { orderId: bOrderId, reason: "attack" })).rejects.toMatchObject(NOT_VISIBLE);
    const order = await db.order.findUniqueOrThrow({ where: { id: bOrderId } });
    expect(order.status).toBe("PLACED");
  });

  it("cannot record or void payments on B's orders or read B's bills", async () => {
    await expect(recordPayment(A.owner, { orderId: bOrderId, amountMinor: 100, method: "CASH" })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(voidPayment(A.owner, { paymentId: bPaymentId, reason: "attack" })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(getSessionBill(A.owner, bSessionId)).rejects.toMatchObject(NOT_VISIBLE);
    expect((await db.paymentRecord.findUniqueOrThrow({ where: { id: bPaymentId } })).status).toBe("RECORDED");
  });

  it("cannot handle B's waiter calls or print jobs", async () => {
    await expect(updateServiceRequest(A.owner, { requestId: bRequestId, action: "resolve" })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    const job = await db.printerConfiguration.create({
      data: { tenantId: B.tenantId, branchId: B.branchId, name: "B printer" },
    });
    const pj = await db.printJob.create({
      data: { tenantId: B.tenantId, branchId: B.branchId, ticketId: bTicketId, printerId: job.id },
    });
    await expect(markPrintJob(A.owner, { jobId: pj.id, outcome: "PRINTED" })).rejects.toMatchObject(NOT_VISIBLE);
  });

  it("does not include B in A's reports or exports", async () => {
    const dash = await getDashboard(A.owner, { range: "30d" });
    const csv = await exportOrdersCsv(A.owner, new Date(0), new Date(Date.now() + 86_400_000));
    const bOrder = await db.order.findUniqueOrThrow({ where: { id: bOrderId } });
    expect(csv).not.toContain(bOrder.publicToken);
    await expect(getDashboard(A.owner, { range: "today", branchId: B.branchId })).rejects.toMatchObject(NOT_VISIBLE);
    expect(dash.branches.every((b) => b.id !== B.branchId)).toBe(true);
    const audit = await getTenantAudit(A.owner);
    expect(audit.every((e) => e.tenantId === A.tenantId)).toBe(true);
  });
});

describe("Restaurant A cannot manage Restaurant B's tables, staff or billing", () => {
  it("cannot create tables in B's branch or touch B's tables/QR codes", async () => {
    await expect(createTable(A.owner, { branchId: B.branchId, label: "X" })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(updateTable(A.owner, { tableId: B.tableId, label: "X", isActive: false })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(regenerateTableQr(A.owner, { tableId: B.tableId })).rejects.toMatchObject(NOT_VISIBLE);
    await expect(listTables(A.owner, B.branchId)).rejects.toMatchObject(NOT_VISIBLE);
    await expect(getQrSheet(A.owner, B.branchId)).rejects.toMatchObject(NOT_VISIBLE);
    expect(await db.tableQrToken.count({ where: { tableId: B.tableId, status: "ACTIVE" } })).toBe(1);
  });

  it("cannot see or change B's staff", async () => {
    const aStaff = await listStaff(A.owner);
    const bMembers = await db.membership.findMany({ where: { tenantId: B.tenantId } });
    expect(aStaff.some((s) => bMembers.some((m) => m.id === s.id))).toBe(false);
    const bWaiter = bMembers.find((m) => m.role === "WAITER")!;
    await expect(setStaffActive(A.owner, { membershipId: bWaiter.id, active: false })).rejects.toMatchObject(
      NOT_VISIBLE,
    );
    await expect(
      updateStaff(A.owner, { membershipId: bWaiter.id, role: "MANAGER", allBranches: true, branches: [] }),
    ).rejects.toMatchObject(NOT_VISIBLE);
    await expect(
      inviteStaff(A.owner, { name: "Spy", email: "spy@example.test", role: "WAITER", branchIds: [B.branchId] }),
    ).rejects.toMatchObject(NOT_VISIBLE);
  });

  it("cannot read B's invoices", async () => {
    const inv = await createInvoice(B.admin, {
      tenantId: B.tenantId,
      periodStart: new Date(),
      periodEnd: new Date(),
      dueDate: new Date(),
      lines: [{ description: "Plan", quantity: 1, unitPriceMinor: 100_000 }],
      issue: true,
    });
    await expect(getTenantInvoice(A.owner, inv.id)).rejects.toMatchObject(NOT_VISIBLE);
    const billing = await getTenantBilling(A.owner);
    expect(billing.invoices.some((i) => i.id === inv.id)).toBe(false);
  });
});

describe("membership is required to obtain a tenant context", () => {
  it("A's owner cannot load B's context by slug", async () => {
    await expect(loadTenantContext(A.owner.user, B.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deactivated memberships lose access", async () => {
    const m = await db.membership.findFirstOrThrow({ where: { tenantId: A.tenantId, userId: A.waiter.user.id } });
    await db.membership.update({ where: { id: m.id }, data: { isActive: false } });
    await expect(loadTenantContext(A.waiter.user, A.slug)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.membership.update({ where: { id: m.id }, data: { isActive: true } });
  });
});

describe("branch-level isolation inside one restaurant", () => {
  it("a waiter assigned to branch 2 cannot see or act on branch 1", async () => {
    const res = await placeOrder(sampleCart(A));
    const order = await db.order.findUniqueOrThrow({ where: { publicToken: res.publicToken } });
    await expect(getOrderDetail(A.waiterBranch2, order.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getFloorBoard(A.waiterBranch2, A.branchId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      recordPayment(A.waiterBranch2, { orderId: order.id, amountMinor: 100, method: "CASH" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const list = await listOrders(A.waiterBranch2, { scope: "all" });
    expect(list.some((o) => o.id === order.id)).toBe(false);
  });
});

describe("role restrictions", () => {
  it("a waiter cannot perform SUPER_ADMIN actions", async () => {
    await expect(
      createTenant(A.waiter.user, {
        name: "Evil",
        slug: "evil-co",
        branchName: "Main",
        ownerName: "Evil",
        ownerEmail: "evil@example.test",
        planId: await ensurePlan(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setTenantStatus(A.waiter.user, { tenantId: B.tenantId, status: "SUSPENDED", reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listTenants(A.waiter.user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listInvoices(A.owner.user)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      changeSubscription(A.owner.user, { tenantId: A.tenantId, status: "ACTIVE", reason: "free stuff" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a billing-only platform user cannot manage tenants", async () => {
    const billing = await makeUser({ platformRole: "PLATFORM_BILLING" });
    await expect(
      setTenantStatus(billing, { tenantId: B.tenantId, status: "SUSPENDED", reason: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a kitchen user cannot access financial information", async () => {
    await expect(getDashboard(A.kitchen, { range: "today" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTenantBilling(A.kitchen)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(exportOrdersCsv(A.kitchen, new Date(0), new Date())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const session = await db.tableSession.findFirstOrThrow({ where: { tenantId: A.tenantId } });
    await expect(getSessionBill(A.kitchen, session.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const floor = await getFloorBoard(A.kitchen, A.branchId);
    expect(floor.showMoney).toBe(false);
    expect(floor.orders.every((o) => o.totalMinor === null)).toBe(true);
    expect(floor.tables.every((t) => t.outstandingMinor === null)).toBe(true);
    const list = await listOrders(A.kitchen, { scope: "all" });
    expect(list.every((o) => o.totalMinor === null)).toBe(true);
  });

  it("waiters and managers cannot manage restaurant-wide settings or billing", async () => {
    await expect(getTenantBilling(A.manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getTenantAudit(A.waiter)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createMenuItem(A.waiter, { categoryId: bCategoryId, name: "x", basePriceMinor: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a manager cannot promote staff to owner or change the owner", async () => {
    const ownerMembership = await db.membership.findFirstOrThrow({
      where: { tenantId: A.tenantId, role: "RESTAURANT_OWNER" },
    });
    await expect(setStaffActive(A.manager, { membershipId: ownerMembership.id, active: false })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      inviteStaff(A.manager, {
        name: "New Owner",
        email: "newowner@example.test",
        role: "RESTAURANT_OWNER",
        branchIds: [],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      inviteStaff(A.manager, { name: "New Manager", email: "newmgr@example.test", role: "MANAGER", branchIds: [] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("customer-side protections", () => {
  it("a QR token from B cannot order A's items", async () => {
    const cart = sampleCart(A, B.qrToken);
    await expect(placeOrder(cart)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.orderItem.count({ where: { tenantId: B.tenantId, menuItemId: A.items.burgerId } })).toBe(0);
  });

  it("an invalid or revoked QR token cannot create an order", async () => {
    await expect(placeOrder(sampleCart(A, "Z".repeat(24)))).rejects.toMatchObject({ code: "NOT_FOUND" });
    const old = A.table2Token;
    await regenerateTableQr(A.owner, {
      tableId: (await db.tableQrToken.findUniqueOrThrow({ where: { token: old } })).tableId,
    });
    await expect(placeOrder(sampleCart(A, old))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a customer cannot manipulate submitted prices", async () => {
    const cart = sampleCart(A) as ReturnType<typeof sampleCart> & { totalMinor?: number };
    (cart.lines[1] as Record<string, unknown>).priceMinor = 1;
    (cart.lines[1] as Record<string, unknown>).unitPriceMinor = 1;
    cart.totalMinor = 1;
    const res = await placeOrder(cart);
    expect(res.totalMinor).toBe(35_500);
  });

  it("B's public menu never includes A's items", async () => {
    const menu = await getPublicMenu(B.tenantId, B.branchId);
    const ids = menu.flatMap((c) => c.items.map((i) => i.id));
    expect(ids).not.toContain(A.items.burgerId);
  });
});

describe("database-level guarantees", () => {
  it("rejects a row that links records from two tenants (composite foreign key)", async () => {
    await expect(
      db.diningTable.create({ data: { tenantId: A.tenantId, branchId: B.branchId, label: "Cross" } }),
    ).rejects.toThrow();
    await expect(
      db.menuItem.create({ data: { tenantId: A.tenantId, categoryId: bCategoryId, name: "Cross", basePriceMinor: 1 } }),
    ).rejects.toThrow();
    await expect(
      db.kitchenTicket.create({
        data: {
          tenantId: A.tenantId,
          branchId: A.branchId,
          orderId: bOrderId,
          stationId: (await db.kitchenStation.findFirstOrThrow({ where: { tenantId: A.tenantId } })).id,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces one active QR token and one open session per table", async () => {
    await expect(
      db.tableQrToken.create({
        data: { tenantId: A.tenantId, branchId: A.branchId, tableId: A.tableId, token: "duplicate-active-token-xyz" },
      }),
    ).rejects.toThrow();
    await db.tableSession
      .create({ data: { tenantId: A.tenantId, branchId: A.branchId, tableId: A.tableId } })
      .catch(() => null);
    await expect(
      db.tableSession.create({ data: { tenantId: A.tenantId, branchId: A.branchId, tableId: A.tableId } }),
    ).rejects.toThrow();
  });

  it("rejects inconsistent order money", async () => {
    await expect(db.order.update({ where: { id: bOrderId }, data: { amountPaidMinor: 10_000_000 } })).rejects.toThrow();
    await expect(db.order.update({ where: { id: bOrderId }, data: { totalMinor: 1 } })).rejects.toThrow();
  });
});
