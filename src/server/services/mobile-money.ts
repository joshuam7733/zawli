// Pay-first with mobile money (MTN MoMo, Airtel Money).
//
// Flow: guest orders → order is PENDING_PAYMENT (kitchen sees nothing) → guest
// picks MTN or Airtel and enters their number → provider pushes a PIN prompt →
// we ask the provider for the status (polling, callbacks only trigger a check) →
// SUCCESSFUL: payment recorded and the order is released to the kitchen.
// Orders not paid within the restaurant's time limit are cancelled.
import { z } from "zod";
import { MobileMoneyEnvironment, MobileMoneyProvider, PaymentTiming } from "@/generated/prisma/enums";
import { maskPhone, normalizeUgPhone, PROVIDER_LABEL } from "@/domain/phone";
import { db, type Tx } from "../db";
import { AppError, isUniqueViolation, notFound, validation } from "../errors";
import { requirePermission, requireWritable, type TenantContext } from "../authz";
import { writeAudit } from "../audit";
import { recordBranchEvent, signalBranch } from "../events";
import { logError, logWarn } from "../log";
import { encryptJson } from "../secrets";
import { isWellFormedToken, randomUUID } from "../tokens";
import { clientFor, ProviderError, simulatorAllowed } from "../mobile-money";
import { releaseToKitchen } from "./kitchen-release";

/** Minimum gap between provider status checks for one payment. */
const CHECK_INTERVAL_MS = 2_500;
/** Stop waiting for an unanswered PIN prompt after this long (providers time out well before). */
const GIVE_UP_AFTER_MS = 30 * 60_000;
/** A payment started close to the deadline gets at least this long to be approved. */
const MIN_APPROVAL_WINDOW_MS = 3 * 60_000;

function appUrl() {
  return (process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

function newReference(provider: MobileMoneyProvider): string {
  // MTN requires a UUID v4 X-Reference-Id; Airtel accepts a short alphanumeric id.
  const uuid = randomUUID();
  return provider === "MTN_MOMO" ? uuid : `ZW${uuid.replace(/-/g, "").slice(0, 18).toUpperCase()}`;
}

// ───────────── Guest: start a payment ─────────────

export const startPaymentSchema = z.object({
  publicToken: z.string().min(20).max(64),
  provider: z.enum(MobileMoneyProvider),
  phone: z.string().trim().min(9).max(20),
});

export type GuestPaymentResult =
  | { status: "PENDING"; provider: MobileMoneyProvider; maskedPhone: string }
  | { status: "SUCCESSFUL" }
  | { status: "FAILED"; message: string };

export async function startMobileMoneyPayment(input: z.input<typeof startPaymentSchema>): Promise<GuestPaymentResult> {
  const data = startPaymentSchema.parse(input);
  if (!isWellFormedToken(data.publicToken)) throw notFound("Order");
  const order = await db.order.findUnique({
    where: { publicToken: data.publicToken },
    include: {
      tenant: {
        select: { name: true, isDemo: true, status: true, mobileMoney: { where: { provider: data.provider } } },
      },
    },
  });
  if (!order) throw notFound("Order");
  if (order.status !== "PENDING_PAYMENT") {
    if (order.paymentStatus === "PAID") return { status: "SUCCESSFUL" };
    throw validation(
      order.status === "CANCELLED"
        ? "This order was cancelled. Please order again."
        : "This order doesn't need payment.",
    );
  }
  if (order.tenant.status !== "ACTIVE")
    throw new AppError("UNAVAILABLE", "This restaurant is not taking payments right now.");
  if (order.paymentDueBy && order.paymentDueBy < new Date()) {
    await expireOverdueOrders({ orderId: order.id });
    throw validation("Time to pay has run out, so the order was cancelled. Please order again.");
  }
  const account = order.tenant.mobileMoney[0];
  if (!account?.isEnabled) throw validation(`${PROVIDER_LABEL[data.provider]} isn't available at this restaurant.`);
  const phone = normalizeUgPhone(data.phone, data.provider);
  if (!phone.ok) throw validation(phone.error);

  // One prompt at a time: an unanswered request is reused, never duplicated.
  const pending = await db.paymentIntent.findFirst({
    where: { orderId: order.id, tenantId: order.tenantId, status: "PENDING" },
  });
  if (pending) {
    const now = await refreshIntent(pending.id, { force: true });
    if (now === "PENDING")
      return { status: "PENDING", provider: pending.provider, maskedPhone: maskPhone(pending.payerPhone) };
    if (now === "SUCCESSFUL") return { status: "SUCCESSFUL" };
    // the previous attempt just failed: fall through and start a new one
  }

  const client = clientFor(account, order.tenant.isDemo);
  const reference = newReference(data.provider);
  let intentId: string;
  try {
    const intent = await db.$transaction(async (tx) => {
      const created = await tx.paymentIntent.create({
        data: {
          tenantId: order.tenantId,
          branchId: order.branchId,
          orderId: order.id,
          provider: data.provider,
          environment: account.environment,
          status: "PENDING",
          amountMinor: order.totalMinor - order.amountPaidMinor,
          currency: order.currency,
          payerPhone: phone.msisdn,
          providerReference: reference,
        },
      });
      const minDue = new Date(Date.now() + MIN_APPROVAL_WINDOW_MS);
      if (!order.paymentDueBy || order.paymentDueBy < minDue) {
        await tx.order.updateMany({
          where: { id: order.id, status: "PENDING_PAYMENT" },
          data: { paymentDueBy: minDue },
        });
      }
      return created;
    });
    intentId = intent.id;
  } catch (e) {
    if (isUniqueViolation(e)) {
      // A parallel tap already started a payment for this order.
      const other = await db.paymentIntent.findFirst({ where: { orderId: order.id, status: "PENDING" } });
      if (other) return { status: "PENDING", provider: other.provider, maskedPhone: maskPhone(other.payerPhone) };
    }
    throw e;
  }

  try {
    await client.requestPayment({
      reference,
      amountMinor: order.totalMinor - order.amountPaidMinor,
      currency: order.currency,
      msisdn: phone.msisdn,
      description: `${order.tenant.name} order ${order.reference}`,
      callbackUrl: `${appUrl()}/api/public/payments/callback?ref=${encodeURIComponent(reference)}`,
    });
  } catch (e) {
    const message = e instanceof ProviderError ? e.publicMessage : "The payment couldn't be started. Please try again.";
    logError("mobile_money.request_failed", e, { provider: data.provider, orderId: order.id });
    await db.paymentIntent.updateMany({
      where: { id: intentId, status: "PENDING" },
      data: { status: "FAILED", failureReason: message, completedAt: new Date() },
    });
    return { status: "FAILED", message };
  }
  return { status: "PENDING", provider: data.provider, maskedPhone: maskPhone(phone.msisdn) };
}

// ───────────── Confirming with the provider ─────────────

/**
 * Asks the provider for the latest status of one payment and applies it.
 * Idempotent and safe to call from polling, callbacks and the sweeper at once.
 */
export async function refreshIntent(intentId: string, opts: { force?: boolean } = {}) {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    include: { tenant: { select: { isDemo: true, mobileMoney: true } } },
  });
  if (!intent) return null;
  if (intent.status !== "PENDING") return intent.status;
  if (!opts.force && intent.lastCheckedAt && Date.now() - intent.lastCheckedAt.getTime() < CHECK_INTERVAL_MS)
    return "PENDING";

  const account = intent.tenant.mobileMoney.find((a) => a.provider === intent.provider);
  let result: Awaited<ReturnType<ReturnType<typeof clientFor>["getStatus"]>>;
  try {
    if (!account) throw new ProviderError("Provider account removed");
    // Status is checked with the environment the payment was created in.
    result = await clientFor({ ...account, environment: intent.environment }, intent.tenant.isDemo).getStatus({
      reference: intent.providerReference,
      msisdn: intent.payerPhone,
      currency: intent.currency,
      createdAt: intent.createdAt,
    });
  } catch (e) {
    logWarn("mobile_money.status_check_failed", {
      intentId,
      provider: intent.provider,
      error: e instanceof Error ? e.message : String(e),
    });
    result = { status: "PENDING" };
  }

  if (result.status === "SUCCESSFUL") {
    const settled = await db.$transaction((tx) => settleSuccessfulIntent(tx, intent.id, result.transactionId), {
      timeout: 15_000,
    });
    if (settled) signalBranch(intent.branchId);
    return "SUCCESSFUL";
  }
  if (result.status === "FAILED") {
    await db.paymentIntent.updateMany({
      where: { id: intent.id, status: "PENDING" },
      data: {
        status: "FAILED",
        failureReason: result.reason,
        completedAt: new Date(),
        lastCheckedAt: new Date(),
        checkCount: { increment: 1 },
      },
    });
    return "FAILED";
  }
  const gaveUp = Date.now() - intent.createdAt.getTime() > GIVE_UP_AFTER_MS;
  await db.paymentIntent.updateMany({
    where: { id: intent.id, status: "PENDING" },
    data: gaveUp
      ? { status: "EXPIRED", failureReason: "No approval was received.", completedAt: new Date() }
      : { lastCheckedAt: new Date(), checkCount: { increment: 1 } },
  });
  return gaveUp ? "EXPIRED" : "PENDING";
}

/** Records a confirmed provider payment and releases the order to the kitchen. */
async function settleSuccessfulIntent(tx: Tx, intentId: string, transactionId: string | null): Promise<boolean> {
  const claimed = await tx.paymentIntent.updateMany({
    where: { id: intentId, status: "PENDING" },
    data: {
      status: "SUCCESSFUL",
      providerTransactionId: transactionId,
      completedAt: new Date(),
      lastCheckedAt: new Date(),
    },
  });
  if (claimed.count !== 1) return false; // someone else settled it
  const intent = await tx.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${intent.orderId} FOR UPDATE`;
  const order = await tx.order.findFirstOrThrow({ where: { id: intent.orderId, tenantId: intent.tenantId } });
  const outstanding = order.totalMinor - order.amountPaidMinor;
  const label = PROVIDER_LABEL[intent.provider];

  if (order.status === "CANCELLED" || outstanding <= 0) {
    // Money arrived but can't be applied (order cancelled or already paid): staff must refund.
    await writeAudit(tx, {
      tenantId: intent.tenantId,
      action: "payment.mobile_money_refund_needed",
      entityType: "PaymentIntent",
      entityId: intent.id,
      metadata: {
        orderReference: order.reference,
        provider: intent.provider,
        amountMinor: intent.amountMinor,
        transactionId,
      },
    });
    await tx.notification.create({
      data: {
        tenantId: intent.tenantId,
        branchId: intent.branchId,
        type: "payment.refund_needed",
        title: `Refund ${label} payment for order ${order.reference}`,
        body: `${label} payment ${transactionId ?? intent.providerReference} from ${maskPhone(intent.payerPhone)} arrived after the order was ${order.status === "CANCELLED" ? "cancelled" : "already paid"}.`,
        entityType: "Order",
        entityId: order.id,
      },
    });
    return true;
  }

  const amount = Math.min(intent.amountMinor, outstanding);
  const newPaid = order.amountPaidMinor + amount;
  const record = await tx.paymentRecord.create({
    data: {
      tenantId: intent.tenantId,
      branchId: intent.branchId,
      orderId: order.id,
      amountMinor: amount,
      method: "MOBILE_MONEY",
      source: "PROVIDER",
      reference: transactionId ?? intent.providerReference,
      note: `${label} · ${maskPhone(intent.payerPhone)}${intent.environment === "PRODUCTION" ? "" : ` · ${intent.environment.toLowerCase()}`}`,
    },
  });
  await tx.paymentIntent.update({ where: { id: intent.id }, data: { paymentRecordId: record.id } });
  await tx.order.update({
    where: { id: order.id },
    data: { amountPaidMinor: newPaid, paymentStatus: newPaid >= order.totalMinor ? "PAID" : "PARTIALLY_PAID" },
  });
  await writeAudit(tx, {
    tenantId: intent.tenantId,
    action: "payment.mobile_money_received",
    entityType: "PaymentRecord",
    entityId: record.id,
    metadata: {
      orderReference: order.reference,
      provider: intent.provider,
      amountMinor: amount,
      environment: intent.environment,
    },
  });
  await recordBranchEvent(tx, {
    tenantId: intent.tenantId,
    branchId: intent.branchId,
    type: "payment.recorded",
    entityId: order.id,
  });
  if (newPaid >= order.totalMinor) {
    await releaseToKitchen(tx, order, { type: "SYSTEM", id: null }, `Paid by ${label}`);
  }
  return true;
}

// ───────────── Expiry & background checks ─────────────

/**
 * Cancels pay-first orders that were not paid in time. An order whose payment
 * prompt is still being answered is kept until that payment resolves.
 */
export async function expireOverdueOrders(filter: { orderId?: string } = {}) {
  const now = new Date();
  const overdue = await db.order.findMany({
    where: { status: "PENDING_PAYMENT", paymentDueBy: { lt: now }, ...(filter.orderId ? { id: filter.orderId } : {}) },
    take: 100,
    select: { id: true, tenantId: true, branchId: true, reference: true },
  });
  let cancelled = 0;
  for (const o of overdue) {
    const pending = await db.paymentIntent.findFirst({ where: { orderId: o.id, status: "PENDING" } });
    if (pending) {
      const s = await refreshIntent(pending.id, { force: true });
      if (s === "PENDING" || s === "SUCCESSFUL") continue;
    }
    const done = await db.$transaction(async (tx) => {
      const res = await tx.order.updateMany({
        where: { id: o.id, status: "PENDING_PAYMENT" },
        data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Not paid in time", paymentDueBy: null },
      });
      if (res.count !== 1) return false;
      await tx.orderStatusHistory.create({
        data: {
          tenantId: o.tenantId,
          orderId: o.id,
          fromStatus: "PENDING_PAYMENT",
          toStatus: "CANCELLED",
          actorType: "SYSTEM",
          reason: "Not paid in time",
        },
      });
      await recordBranchEvent(tx, {
        tenantId: o.tenantId,
        branchId: o.branchId,
        type: "order.updated",
        entityId: o.id,
      });
      return true;
    });
    if (done) {
      cancelled++;
      signalBranch(o.branchId);
    }
  }
  return cancelled;
}

let sweeping = false;
/** Re-checks pending payments and expires overdue orders. Run every ~20 s. */
export async function sweepMobileMoney() {
  if (sweeping) return { checked: 0, expired: 0 };
  sweeping = true;
  try {
    const pending = await db.paymentIntent.findMany({
      where: {
        status: "PENDING",
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(Date.now() - 10_000) } }],
      },
      orderBy: { createdAt: "asc" },
      take: 50,
      select: { id: true },
    });
    for (const p of pending) await refreshIntent(p.id);
    const expired = await expireOverdueOrders();
    return { checked: pending.length, expired };
  } finally {
    sweeping = false;
  }
}

/** Provider callback: never trusted, it only triggers a status check. */
export async function handleProviderCallback(reference: string | null) {
  if (!reference || reference.length > 64) return;
  const intent = await db.paymentIntent.findUnique({ where: { providerReference: reference }, select: { id: true } });
  if (intent) await refreshIntent(intent.id, { force: true });
}

/** Payment state for the guest's order page (refreshes a pending payment first). */
export async function getGuestPaymentState(orderId: string) {
  const latest = await db.paymentIntent.findFirst({ where: { orderId }, orderBy: { createdAt: "desc" } });
  if (latest?.status === "PENDING") await refreshIntent(latest.id);
  await expireOverdueOrders({ orderId });
  const intent = latest ? await db.paymentIntent.findUnique({ where: { id: latest.id } }) : null;
  return intent
    ? {
        provider: intent.provider,
        status: intent.status,
        maskedPhone: maskPhone(intent.payerPhone),
        failureReason: intent.failureReason,
        simulated: intent.environment === "SIMULATOR",
      }
    : null;
}

// ───────────── Restaurant settings ─────────────

export async function getMobileMoneySettings(ctx: TenantContext) {
  requirePermission(ctx, "tenant.settings.manage");
  const [settings, accounts] = await Promise.all([
    db.restaurantSettings.findUnique({
      where: { tenantId: ctx.tenant.id },
      select: { paymentTiming: true, unpaidOrderTimeoutMinutes: true },
    }),
    db.mobileMoneyAccount.findMany({ where: { tenantId: ctx.tenant.id } }),
  ]);
  return {
    paymentTiming: settings?.paymentTiming ?? "PAY_FIRST",
    unpaidOrderTimeoutMinutes: settings?.unpaidOrderTimeoutMinutes ?? 15,
    accounts: (["MTN_MOMO", "AIRTEL_MONEY"] as const).map((provider) => {
      const a = accounts.find((x) => x.provider === provider);
      return {
        provider,
        isEnabled: a?.isEnabled ?? false,
        environment: a?.environment ?? ("SIMULATOR" as const),
        hasCredentials: !!a?.credentialsEnc,
        updatedAt: a?.updatedAt ?? null,
      };
    }),
  };
}

export const paymentTimingSchema = z.object({
  paymentTiming: z.enum(PaymentTiming),
  unpaidOrderTimeoutMinutes: z.coerce.number().int().min(5, "At least 5 minutes.").max(120, "At most 120 minutes."),
});

export async function savePaymentTiming(ctx: TenantContext, input: z.input<typeof paymentTimingSchema>) {
  requirePermission(ctx, "tenant.settings.manage");
  requireWritable(ctx);
  const data = paymentTimingSchema.parse(input);
  await db.$transaction(async (tx) => {
    await tx.restaurantSettings.update({ where: { tenantId: ctx.tenant.id }, data });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "payments.timing_updated",
      entityType: "RestaurantSettings",
      entityId: ctx.tenant.id,
      metadata: data,
    });
  });
}

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const mobileMoneyAccountSchema = z.object({
  provider: z.enum(MobileMoneyProvider),
  isEnabled: z.boolean(),
  environment: z.enum(MobileMoneyEnvironment),
  // MTN MoMo (leave blank to keep the saved value)
  subscriptionKey: text(200),
  apiUser: text(200),
  apiKey: text(200),
  targetEnvironment: text(40),
  // Airtel Money
  clientId: text(200),
  clientSecret: text(200),
  country: text(2),
});

/** Saves a provider account. Credentials are write-only: blank fields keep what's stored. */
export async function saveMobileMoneyAccount(ctx: TenantContext, input: z.input<typeof mobileMoneyAccountSchema>) {
  requirePermission(ctx, "tenant.settings.manage");
  requireWritable(ctx);
  const data = mobileMoneyAccountSchema.parse(input);
  if (data.isEnabled && data.environment === "SIMULATOR" && !simulatorAllowed(ctx.tenant.isDemo)) {
    throw validation("The simulator is for demos only. Choose Sandbox or Live and enter your API keys.");
  }
  const existing = await db.mobileMoneyAccount.findUnique({
    where: { tenantId_provider: { tenantId: ctx.tenant.id, provider: data.provider } },
  });
  const fresh =
    data.provider === "MTN_MOMO"
      ? {
          subscriptionKey: data.subscriptionKey,
          apiUser: data.apiUser,
          apiKey: data.apiKey,
          targetEnvironment: data.targetEnvironment,
        }
      : { clientId: data.clientId, clientSecret: data.clientSecret, country: data.country?.toUpperCase() };
  const provided = Object.values(fresh).some(Boolean);
  let credentialsEnc = existing?.credentialsEnc ?? null;
  if (provided) {
    const required =
      data.provider === "MTN_MOMO" ? ["subscriptionKey", "apiUser", "apiKey"] : ["clientId", "clientSecret"];
    const missing = required.filter((k) => !fresh[k as keyof typeof fresh]);
    if (missing.length) throw validation("Enter all the API details together (they replace the saved ones).");
    credentialsEnc = encryptJson(fresh);
  }
  if (data.isEnabled && data.environment !== "SIMULATOR" && !credentialsEnc) {
    throw validation(`Enter your ${PROVIDER_LABEL[data.provider]} API details before turning it on.`);
  }
  await db.$transaction(async (tx) => {
    await tx.mobileMoneyAccount.upsert({
      where: { tenantId_provider: { tenantId: ctx.tenant.id, provider: data.provider } },
      create: {
        tenantId: ctx.tenant.id,
        provider: data.provider,
        isEnabled: data.isEnabled,
        environment: data.environment,
        credentialsEnc,
        updatedById: ctx.user.id,
      },
      update: { isEnabled: data.isEnabled, environment: data.environment, credentialsEnc, updatedById: ctx.user.id },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "payments.mobile_money_updated",
      entityType: "MobileMoneyAccount",
      entityId: data.provider,
      metadata: {
        provider: data.provider,
        isEnabled: data.isEnabled,
        environment: data.environment,
        credentialsChanged: provided,
      },
    });
  });
}

/** Checks the saved credentials by requesting an access token from the provider. */
export async function testMobileMoneyConnection(ctx: TenantContext, provider: MobileMoneyProvider) {
  requirePermission(ctx, "tenant.settings.manage");
  const account = await db.mobileMoneyAccount.findUnique({
    where: { tenantId_provider: { tenantId: ctx.tenant.id, provider } },
  });
  if (!account) throw validation(`Save your ${PROVIDER_LABEL[provider]} details first.`);
  try {
    await clientFor(account, ctx.tenant.isDemo).testConnection();
  } catch (e) {
    throw validation(e instanceof ProviderError ? e.publicMessage : "Couldn't reach the provider. Try again.");
  }
}
