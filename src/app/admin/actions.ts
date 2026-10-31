"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAction, type ActionResult } from "@/server/action";
import { getSessionUser } from "@/server/session";
import { parseMoneyInput } from "@/domain/money";
import { validation } from "@/server/errors";
import {
  createTenant,
  reissueOwnerSetupLink,
  setTenantStatus,
  updateTenantProfile,
} from "@/server/services/platform-tenants";
import {
  changeSubscription,
  createInvoice,
  issueInvoice,
  recordInvoicePayment,
  runBillingSweep,
  savePlan,
  voidInvoice,
} from "@/server/services/billing";
import type {
  BillingInterval,
  FulfillmentMode,
  PaymentMethod,
  SubscriptionStatus,
  TenantStatus,
} from "@/generated/prisma/enums";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const on = (fd: FormData, k: string) => fd.get(k) === "on";

function money(fd: FormData, key: string, currency: string, label: string): number {
  const v = parseMoneyInput(s(fd, key), currency);
  if (v === null) throw validation(`Enter a valid ${label}.`);
  return v;
}

export async function createTenantAction(
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ tenantId: string; ownerSetupUrl: string | null; ownerExisted: boolean }>> {
  return runAction(async () => {
    const user = await getSessionUser();
    const res = await createTenant(user, {
      name: s(fd, "name"),
      slug: s(fd, "slug"),
      legalName: s(fd, "legalName"),
      contactEmail: s(fd, "contactEmail"),
      contactPhone: s(fd, "contactPhone"),
      addressLine: s(fd, "addressLine"),
      city: s(fd, "city"),
      country: s(fd, "country") || "UG",
      currency: s(fd, "currency") || "UGX",
      timezone: s(fd, "timezone") || "Africa/Kampala",
      locale: s(fd, "locale") || "en-UG",
      brandPrimary: s(fd, "brandPrimary") || "#14532D",
      brandAccent: s(fd, "brandAccent") || "#A3E635",
      branchName: s(fd, "branchName"),
      fulfillmentMode: s(fd, "fulfillmentMode") as FulfillmentMode,
      ownerName: s(fd, "ownerName"),
      ownerEmail: s(fd, "ownerEmail"),
      planId: s(fd, "planId"),
      subscriptionStatus: s(fd, "subscriptionStatus") === "ACTIVE" ? "ACTIVE" : "TRIAL",
      trialDays: s(fd, "trialDays") || "14",
      enableWaiterCalls: on(fd, "enableWaiterCalls"),
      enableBillRequests: on(fd, "enableBillRequests"),
      taxEnabled: on(fd, "taxEnabled"),
      taxRatePercent: s(fd, "taxRatePercent") || "0",
      taxInclusive: s(fd, "taxInclusive") !== "exclusive",
      serviceChargeEnabled: on(fd, "serviceChargeEnabled"),
      serviceChargePercent: s(fd, "serviceChargePercent") || "0",
    });
    revalidatePath("/admin", "layout");
    return { tenantId: res.tenantId, ownerSetupUrl: res.ownerSetupUrl, ownerExisted: res.ownerExisted };
  });
}

export async function updateTenantAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const user = await getSessionUser();
    await updateTenantProfile(user, {
      tenantId: s(fd, "tenantId"),
      name: s(fd, "name"),
      legalName: s(fd, "legalName"),
      contactEmail: s(fd, "contactEmail"),
      contactPhone: s(fd, "contactPhone"),
      addressLine: s(fd, "addressLine"),
      city: s(fd, "city"),
      country: s(fd, "country"),
      currency: s(fd, "currency"),
      timezone: s(fd, "timezone"),
      locale: s(fd, "locale"),
      brandPrimary: s(fd, "brandPrimary"),
      brandAccent: s(fd, "brandAccent"),
    });
    revalidatePath("/admin", "layout");
  }, "Restaurant saved");
}

export async function setTenantStatusAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const user = await getSessionUser();
    await setTenantStatus(user, {
      tenantId: s(fd, "tenantId"),
      status: s(fd, "status") as TenantStatus,
      reason: s(fd, "reason"),
    });
    revalidatePath("/admin", "layout");
  }, "Status updated");
}

export async function reissueOwnerLinkAction(
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ setupUrl: string | null }>> {
  return runAction(async () => {
    const user = await getSessionUser();
    return { setupUrl: await reissueOwnerSetupLink(user, { tenantId: s(fd, "tenantId"), userId: s(fd, "userId") }) };
  });
}

export async function changeSubscriptionAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const user = await getSessionUser();
    await changeSubscription(user, {
      tenantId: s(fd, "tenantId"),
      status: (s(fd, "status") || undefined) as SubscriptionStatus | undefined,
      planId: s(fd, "planId") || null,
      currentPeriodEnd: s(fd, "currentPeriodEnd") || null,
      reason: s(fd, "reason"),
    });
    revalidatePath("/admin", "layout");
  }, "Subscription updated");
}

export async function savePlanAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const user = await getSessionUser();
    const currency = (s(fd, "currency") || "UGX").toUpperCase();
    await savePlan(user, {
      planId: s(fd, "planId") || null,
      code: s(fd, "code"),
      name: s(fd, "name"),
      description: s(fd, "description"),
      priceMinor: money(fd, "price", currency, "price"),
      currency,
      billingInterval: (s(fd, "billingInterval") || "MONTHLY") as BillingInterval,
      maxBranches: s(fd, "maxBranches") ? Number(s(fd, "maxBranches")) : null,
      isActive: on(fd, "isActive"),
    });
    revalidatePath("/admin/plans");
  }, "Plan saved");
}

export async function createInvoiceAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  let invoiceId: string | null = null;
  const res = await runAction(async () => {
    const user = await getSessionUser();
    const currency = s(fd, "currency") || "UGX";
    const descriptions = fd.getAll("lineDescription").map(String);
    const quantities = fd.getAll("lineQuantity").map(String);
    const prices = fd.getAll("linePrice").map(String);
    const lines = descriptions
      .map((d, i) => ({ d: d.trim(), q: quantities[i], p: prices[i] }))
      .filter((l) => l.d)
      .map((l) => {
        const unit = parseMoneyInput(l.p ?? "", currency);
        if (unit === null) throw validation(`Enter a valid price for “${l.d}”.`);
        return { description: l.d, quantity: Number(l.q || "1"), unitPriceMinor: unit };
      });
    const inv = await createInvoice(user, {
      tenantId: s(fd, "tenantId"),
      periodStart: s(fd, "periodStart"),
      periodEnd: s(fd, "periodEnd"),
      dueDate: s(fd, "dueDate"),
      lines,
      taxMinor: s(fd, "tax") ? money(fd, "tax", currency, "tax amount") : 0,
      notes: s(fd, "notes"),
      issue: s(fd, "intent") === "issue",
    });
    invoiceId = inv.id;
    revalidatePath("/admin", "layout");
  });
  if (res.ok && invoiceId) redirect(`/admin/invoices/${invoiceId}`);
  return res;
}

export async function issueInvoiceAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    await issueInvoice(await getSessionUser(), { invoiceId: s(fd, "invoiceId") });
    revalidatePath("/admin", "layout");
  }, "Invoice issued");
}

export async function voidInvoiceAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    await voidInvoice(await getSessionUser(), { invoiceId: s(fd, "invoiceId"), reason: s(fd, "reason") });
    revalidatePath("/admin", "layout");
  }, "Invoice voided");
}

export async function recordInvoicePaymentAction(_p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const currency = s(fd, "currency") || "UGX";
    await recordInvoicePayment(await getSessionUser(), {
      invoiceId: s(fd, "invoiceId"),
      amountMinor: money(fd, "amount", currency, "amount"),
      method: s(fd, "method") as PaymentMethod,
      reference: s(fd, "reference"),
      receivedAt: s(fd, "receivedAt"),
      note: s(fd, "note"),
    });
    revalidatePath("/admin", "layout");
  }, "Payment recorded");
}

export async function billingSweepAction(_p: ActionResult): Promise<ActionResult> {
  return runAction(async () => {
    const res = await runBillingSweep(await getSessionUser());
    revalidatePath("/admin", "layout");
    return res;
  }, "Billing check complete");
}
