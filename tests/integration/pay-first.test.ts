// Pay-first: an order reaches the kitchen only after mobile money payment.
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { getPublicOrder, placeOrder, resolveQr } from "@/server/services/ordering";
import { getKitchenBoard } from "@/server/services/orders";
import { recordPayment } from "@/server/services/payments";
import {
  expireOverdueOrders,
  getMobileMoneySettings,
  refreshIntent,
  saveMobileMoneyAccount,
  savePaymentTiming,
  startMobileMoneyPayment,
} from "@/server/services/mobile-money";
import { makeRestaurant, sampleCart, SAMPLE_CART_TOTAL, type TestRestaurant } from "../helpers/fixtures";

let r: TestRestaurant;

async function enableSimulator(
  rest: TestRestaurant,
  providers: ("MTN_MOMO" | "AIRTEL_MONEY")[] = ["MTN_MOMO", "AIRTEL_MONEY"],
) {
  for (const provider of providers) {
    await saveMobileMoneyAccount(rest.owner, { provider, isEnabled: true, environment: "SIMULATOR" });
  }
}

/** Places an order and returns it with its public token. */
async function order(rest = r) {
  const placed = await placeOrder(sampleCart(rest));
  const row = await db.order.findUniqueOrThrow({
    where: { publicToken: placed.publicToken },
    include: { tickets: true },
  });
  return { placed, row };
}

/** Makes the simulator treat the payment as approved (it approves ~5 s after the request). */
async function ageIntent(orderId: string) {
  await db.paymentIntent.updateMany({
    where: { orderId },
    data: { createdAt: new Date(Date.now() - 60_000), lastCheckedAt: null },
  });
}

beforeAll(async () => {
  r = await makeRestaurant({ name: "Pay First Grill", mode: "DIGITAL_AND_PRINTER" });
  await db.printerConfiguration.create({
    data: { tenantId: r.tenantId, branchId: r.branchId, name: "Kitchen", connection: "BROWSER" },
  });
  await enableSimulator(r);
});

describe("without mobile money, nothing changes", () => {
  it("sends orders straight to the kitchen (pay at the restaurant)", async () => {
    const plain = await makeRestaurant();
    const { placed, row } = await order(plain);
    expect(placed.paymentRequired).toBe(false);
    expect(row.status).toBe("PLACED");
    expect(row.tickets).toHaveLength(1);
    const qr = await resolveQr(plain.qrToken);
    expect(qr.ok && qr.data.settings.payFirst).toBe(false);
  });
});

describe("pay-first ordering", () => {
  it("holds the order: no kitchen ticket, no print job, invisible to the kitchen", async () => {
    const { placed, row } = await order();
    expect(placed.paymentRequired).toBe(true);
    expect(row.status).toBe("PENDING_PAYMENT");
    expect(row.paymentDueBy).not.toBeNull();
    expect(row.tickets).toHaveLength(0);
    expect(await db.printJob.count({ where: { ticket: { orderId: row.id } } })).toBe(0);
    const board = await getKitchenBoard(r.kitchen, { branchId: r.branchId });
    expect(board.tickets.some((t) => t.order.id === row.id)).toBe(false);
    const pub = await getPublicOrder(placed.publicToken);
    expect(pub?.paymentRequired).toBe(true);
    expect(pub?.mobileMoneyProviders).toEqual(["AIRTEL_MONEY", "MTN_MOMO"]);
  });

  it("releases the order to the kitchen once MTN MoMo confirms the payment", async () => {
    const { placed, row } = await order();
    const started = await startMobileMoneyPayment({
      publicToken: placed.publicToken,
      provider: "MTN_MOMO",
      phone: "0772 123 456",
    });
    expect(started).toMatchObject({ status: "PENDING", maskedPhone: "0772 ••• 456" });

    // Not approved yet: still held.
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING_PAYMENT");

    await ageIntent(row.id);
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId: row.id } });
    expect(await refreshIntent(intent.id)).toBe("SUCCESSFUL");

    const after = await db.order.findUniqueOrThrow({
      where: { id: row.id },
      include: {
        tickets: { include: { printJobs: true } },
        payments: true,
        statusHistory: { orderBy: { createdAt: "asc" } },
      },
    });
    expect(after.status).toBe("PLACED");
    expect(after.paymentStatus).toBe("PAID");
    expect(after.amountPaidMinor).toBe(SAMPLE_CART_TOTAL);
    expect(after.releasedAt).not.toBeNull();
    expect(after.tickets).toHaveLength(1);
    expect(after.tickets[0].printJobs).toHaveLength(1);
    expect(after.payments).toHaveLength(1);
    expect(after.payments[0]).toMatchObject({
      source: "PROVIDER",
      method: "MOBILE_MONEY",
      recordedById: null,
      amountMinor: SAMPLE_CART_TOTAL,
    });
    expect(after.statusHistory.map((h) => h.toStatus)).toEqual(["PENDING_PAYMENT", "PLACED"]);

    const board = await getKitchenBoard(r.kitchen, { branchId: r.branchId });
    expect(board.tickets.some((t) => t.order.id === row.id)).toBe(true);
  });

  it("works the same with Airtel Money", async () => {
    const { placed, row } = await order();
    expect(
      (
        await startMobileMoneyPayment({
          publicToken: placed.publicToken,
          provider: "AIRTEL_MONEY",
          phone: "0752123456",
        })
      ).status,
    ).toBe("PENDING");
    await ageIntent(row.id);
    await getPublicOrder(placed.publicToken); // the guest's page polling confirms it
    const after = await db.order.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("PLACED");
    expect(after.paymentStatus).toBe("PAID");
  });

  it("keeps the order held when the payment is declined, and allows another try", async () => {
    const { placed, row } = await order();
    await startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123000" });
    const pub = await getPublicOrder(placed.publicToken);
    expect(pub?.status).toBe("PENDING_PAYMENT");
    expect(pub?.payment).toMatchObject({ status: "FAILED", failureReason: "The payment was declined on the phone." });
    expect(await db.kitchenTicket.count({ where: { orderId: row.id } })).toBe(0);

    const retry = await startMobileMoneyPayment({
      publicToken: placed.publicToken,
      provider: "MTN_MOMO",
      phone: "0772123456",
    });
    expect(retry.status).toBe("PENDING");
    expect(await db.paymentIntent.count({ where: { orderId: row.id } })).toBe(2);
  });

  it("never sends a second prompt while one is waiting", async () => {
    const { placed, row } = await order();
    const results = await Promise.all([
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123999" }),
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123999" }),
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123999" }),
    ]);
    expect(results.every((x) => x.status === "PENDING")).toBe(true);
    expect(await db.paymentIntent.count({ where: { orderId: row.id, status: "PENDING" } })).toBe(1);
  });

  it("records the payment exactly once when checks race", async () => {
    const { placed, row } = await order();
    await startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "AIRTEL_MONEY", phone: "0752123456" });
    await ageIntent(row.id);
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId: row.id } });
    await Promise.all([
      refreshIntent(intent.id, { force: true }),
      refreshIntent(intent.id, { force: true }),
      getPublicOrder(placed.publicToken),
    ]);
    expect(await db.paymentRecord.count({ where: { orderId: row.id } })).toBe(1);
    expect(await db.kitchenTicket.count({ where: { orderId: row.id } })).toBe(1);
  });

  it("rejects a number from the wrong network", async () => {
    const { placed } = await order();
    await expect(
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0752123456" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects a provider the restaurant hasn't turned on", async () => {
    const mtnOnly = await makeRestaurant();
    await enableSimulator(mtnOnly, ["MTN_MOMO"]);
    const { placed } = await order(mtnOnly);
    await expect(
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "AIRTEL_MONEY", phone: "0752123456" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });
});

describe("unpaid orders", () => {
  it("are cancelled when time runs out and never reach the kitchen", async () => {
    const { placed, row } = await order();
    await db.order.update({ where: { id: row.id }, data: { paymentDueBy: new Date(Date.now() - 1000) } });
    expect(await expireOverdueOrders({ orderId: row.id })).toBe(1);
    const after = await db.order.findUniqueOrThrow({ where: { id: row.id }, include: { tickets: true } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toBe("Not paid in time");
    expect(after.tickets).toHaveLength(0);
    await expect(
      startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123456" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("are not cancelled while the guest is still approving a prompt", async () => {
    const { placed, row } = await order();
    await startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123999" });
    await db.order.update({ where: { id: row.id }, data: { paymentDueBy: new Date(Date.now() - 1000) } });
    expect(await expireOverdueOrders({ orderId: row.id })).toBe(0);
    expect((await db.order.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING_PAYMENT");
  });

  it("flag a refund when money arrives after the order was cancelled", async () => {
    const { placed, row } = await order();
    await startMobileMoneyPayment({ publicToken: placed.publicToken, provider: "MTN_MOMO", phone: "0772123456" });
    await db.order.update({ where: { id: row.id }, data: { status: "CANCELLED", cancelReason: "test" } });
    await ageIntent(row.id);
    const intent = await db.paymentIntent.findFirstOrThrow({ where: { orderId: row.id } });
    await refreshIntent(intent.id);
    expect(await db.paymentRecord.count({ where: { orderId: row.id } })).toBe(0);
    expect(
      await db.notification.count({ where: { tenantId: r.tenantId, type: "payment.refund_needed", entityId: row.id } }),
    ).toBe(1);
  });

  it("can still be paid by staff, which sends them to the kitchen", async () => {
    const { row } = await order();
    await recordPayment(r.waiter, { orderId: row.id, amountMinor: SAMPLE_CART_TOTAL, method: "CASH" });
    const after = await db.order.findUniqueOrThrow({ where: { id: row.id }, include: { tickets: true } });
    expect(after.status).toBe("PLACED");
    expect(after.tickets).toHaveLength(1);
  });
});

describe("restaurant settings", () => {
  it("only the owner can change mobile money settings", async () => {
    await expect(
      saveMobileMoneyAccount(r.manager, { provider: "MTN_MOMO", isEnabled: false, environment: "SIMULATOR" }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      savePaymentTiming(r.waiter, { paymentTiming: "PAY_AFTER", unpaidOrderTimeoutMinutes: 15 }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(getMobileMoneySettings(r.kitchen)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("requires API keys before a live provider can be turned on, and stores them encrypted", async () => {
    const live = await makeRestaurant();
    await expect(
      saveMobileMoneyAccount(live.owner, { provider: "MTN_MOMO", isEnabled: true, environment: "PRODUCTION" }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await saveMobileMoneyAccount(live.owner, {
      provider: "MTN_MOMO",
      isEnabled: true,
      environment: "PRODUCTION",
      subscriptionKey: "sub-secret",
      apiUser: "user-secret",
      apiKey: "key-secret",
    });
    const row = await db.mobileMoneyAccount.findFirstOrThrow({
      where: { tenantId: live.tenantId, provider: "MTN_MOMO" },
    });
    expect(row.credentialsEnc).toBeTruthy();
    expect(row.credentialsEnc).not.toContain("secret");
    const view = await getMobileMoneySettings(live.owner);
    expect(JSON.stringify(view)).not.toContain("secret");
    expect(view.accounts.find((a) => a.provider === "MTN_MOMO")?.hasCredentials).toBe(true);
    const audit = await db.auditLog.findFirstOrThrow({
      where: { tenantId: live.tenantId, action: "payments.mobile_money_updated" },
      orderBy: { createdAt: "desc" },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain("secret");
  });

  it("switching to pay-after sends new orders straight to the kitchen", async () => {
    const t = await makeRestaurant();
    await enableSimulator(t);
    await savePaymentTiming(t.owner, { paymentTiming: "PAY_AFTER", unpaidOrderTimeoutMinutes: 15 });
    const { row } = await order(t);
    expect(row.status).toBe("PLACED");
  });

  it("restaurant A cannot change restaurant B's mobile money", async () => {
    const b = await makeRestaurant();
    await saveMobileMoneyAccount(r.owner, { provider: "MTN_MOMO", isEnabled: true, environment: "SIMULATOR" });
    expect(await db.mobileMoneyAccount.count({ where: { tenantId: b.tenantId } })).toBe(0);
  });
});
