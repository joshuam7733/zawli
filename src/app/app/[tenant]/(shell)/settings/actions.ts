"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { updateOperationalSettings, updateRestaurantProfile } from "@/server/services/restaurant";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const on = (fd: FormData, k: string) => fd.get(k) === "on";

export async function updateProfileAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateRestaurantProfile(ctx, {
      name: s(fd, "name"),
      contactEmail: s(fd, "contactEmail"),
      contactPhone: s(fd, "contactPhone"),
      addressLine: s(fd, "addressLine"),
      city: s(fd, "city"),
      brandPrimary: s(fd, "brandPrimary"),
      brandAccent: s(fd, "brandAccent"),
      logoUrl: s(fd, "logoUrl"),
    });
    revalidatePath(`/app/${slug}`, "layout");
  }, "Profile saved");
}

export async function updateSettingsAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateOperationalSettings(ctx, {
      enableWaiterCalls: on(fd, "enableWaiterCalls"),
      enableBillRequests: on(fd, "enableBillRequests"),
      enableOrderTracking: on(fd, "enableOrderTracking"),
      allowItemNotes: on(fd, "allowItemNotes"),
      taxEnabled: on(fd, "taxEnabled"),
      taxLabel: s(fd, "taxLabel"),
      taxRatePercent: s(fd, "taxRatePercent") || "0",
      taxInclusive: s(fd, "taxInclusive") === "inclusive",
      serviceChargeEnabled: on(fd, "serviceChargeEnabled"),
      serviceChargeLabel: s(fd, "serviceChargeLabel"),
      serviceChargePercent: s(fd, "serviceChargePercent") || "0",
      tableSessionIdleMinutes: s(fd, "tableSessionIdleMinutes"),
      kitchenDelayWarningMinutes: s(fd, "kitchenDelayWarningMinutes"),
      maxItemQuantity: s(fd, "maxItemQuantity"),
      receiptHeader: s(fd, "receiptHeader"),
      receiptFooter: s(fd, "receiptFooter"),
    });
    revalidatePath(`/app/${slug}/settings`);
  }, "Settings saved");
}
