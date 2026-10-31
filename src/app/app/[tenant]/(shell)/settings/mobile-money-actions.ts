"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { saveMobileMoneyAccount, savePaymentTiming, testMobileMoneyConnection } from "@/server/services/mobile-money";
import type { MobileMoneyEnvironment, MobileMoneyProvider, PaymentTiming } from "@/generated/prisma/enums";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function savePaymentTimingAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await savePaymentTiming(ctx, {
      paymentTiming: s(fd, "paymentTiming") as PaymentTiming,
      unpaidOrderTimeoutMinutes: s(fd, "unpaidOrderTimeoutMinutes"),
    });
    revalidatePath(`/app/${slug}/settings`);
  }, "Payment rule saved");
}

export async function saveMobileMoneyAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await saveMobileMoneyAccount(ctx, {
      provider: s(fd, "provider") as MobileMoneyProvider,
      isEnabled: fd.get("isEnabled") === "on",
      environment: s(fd, "environment") as MobileMoneyEnvironment,
      subscriptionKey: s(fd, "subscriptionKey"),
      apiUser: s(fd, "apiUser"),
      apiKey: s(fd, "apiKey"),
      targetEnvironment: s(fd, "targetEnvironment"),
      clientId: s(fd, "clientId"),
      clientSecret: s(fd, "clientSecret"),
      country: s(fd, "country"),
    });
    revalidatePath(`/app/${slug}/settings`);
  }, "Saved");
}

export async function testMobileMoneyAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await testMobileMoneyConnection(ctx, s(fd, "provider") as MobileMoneyProvider);
  }, "Connected successfully");
}
