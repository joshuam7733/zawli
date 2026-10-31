"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { parseMoneyInput } from "@/domain/money";
import { validation } from "@/server/errors";
import { cancelOrder, completeOrder, markOrderServing } from "@/server/services/orders";
import { recordPayment, settleSession, voidPayment } from "@/server/services/payments";
import { requestReprint } from "@/server/services/printing";
import type { PaymentMethod } from "@/generated/prisma/enums";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

function revalidate(slug: string) {
  revalidatePath(`/app/${slug}/orders`, "layout");
  revalidatePath(`/app/${slug}/bills`, "layout");
}

function optionalMoney(fd: FormData, key: string, currency: string): number | null {
  const raw = s(fd, key).trim();
  if (!raw) return null;
  const v = parseMoneyInput(raw, currency);
  if (v === null) throw validation("Enter a valid amount, numbers only.");
  return v;
}

export async function recordPaymentAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ changeMinor: number }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const amount = optionalMoney(fd, "amount", ctx.tenant.currency);
    if (amount === null) throw validation("Enter the amount received.");
    const res = await recordPayment(ctx, {
      orderId: s(fd, "orderId"),
      amountMinor: amount,
      method: s(fd, "method") as PaymentMethod,
      reference: s(fd, "reference"),
      amountTenderedMinor: optionalMoney(fd, "tendered", ctx.tenant.currency),
      note: s(fd, "note"),
      idempotencyKey: s(fd, "idempotencyKey") || null,
    });
    revalidate(slug);
    return { changeMinor: res.changeMinor };
  }, "Payment recorded");
}

export async function settleSessionAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ changeMinor: number }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const res = await settleSession(ctx, {
      sessionId: s(fd, "sessionId"),
      method: s(fd, "method") as PaymentMethod,
      reference: s(fd, "reference"),
      amountTenderedMinor: optionalMoney(fd, "tendered", ctx.tenant.currency),
    });
    revalidate(slug);
    return { changeMinor: res.changeMinor };
  }, "Bill settled");
}

export async function voidPaymentAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await voidPayment(ctx, { paymentId: s(fd, "paymentId"), reason: s(fd, "reason") });
    revalidate(slug);
  }, "Payment voided");
}

export async function serveAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await markOrderServing(ctx, {
      orderId: s(fd, "orderId"),
      to: s(fd, "to") === "OUT_FOR_DELIVERY" ? "OUT_FOR_DELIVERY" : "SERVED",
    });
    revalidate(slug);
  });
}

export async function completeAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await completeOrder(ctx, { orderId: s(fd, "orderId") });
    revalidate(slug);
  });
}

export async function cancelAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await cancelOrder(ctx, { orderId: s(fd, "orderId"), reason: s(fd, "reason") });
    revalidate(slug);
  }, "Order cancelled");
}

export async function reprintAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const n = await requestReprint(ctx, { ticketId: s(fd, "ticketId") });
    revalidate(slug);
    revalidatePath(`/app/${slug}/printing`);
    return n;
  }, "Reprint queued");
}
