"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import {
  createBranch,
  createStation,
  setCategoryRoute,
  setDefaultStation,
  setStationActive,
  updateBranch,
} from "@/server/services/restaurant";
import { createPrinter, rotateBridgeKey, setPrinterActive } from "@/server/services/printing";
import type { FulfillmentMode, PrinterConnection } from "@/generated/prisma/enums";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const path = (slug: string) => `/app/${slug}/branches`;

function branchFields(fd: FormData) {
  return {
    name: s(fd, "name"),
    slug: s(fd, "slug"),
    addressLine: s(fd, "addressLine"),
    phone: s(fd, "phone"),
    timezone: s(fd, "timezone"),
    fulfillmentMode: s(fd, "fulfillmentMode") as FulfillmentMode,
  };
}

export async function createBranchAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await createBranch(ctx, branchFields(fd));
    revalidatePath(path(slug));
  }, "Branch created with a default kitchen station");
}

export async function updateBranchAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateBranch(ctx, {
      branchId: s(fd, "branchId"),
      ...branchFields(fd),
      isActive: fd.get("isActive") === "on",
    });
    revalidatePath(path(slug));
  }, "Branch saved");
}

export async function createStationAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await createStation(ctx, { branchId: s(fd, "branchId"), name: s(fd, "name") });
    revalidatePath(path(slug));
  }, "Station added");
}

export async function setDefaultStationAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setDefaultStation(ctx, { stationId: s(fd, "stationId") });
    revalidatePath(path(slug));
  });
}

export async function setStationActiveAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setStationActive(ctx, { stationId: s(fd, "stationId"), active: s(fd, "active") === "true" });
    revalidatePath(path(slug));
  });
}

export async function saveRoutingAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const branchId = s(fd, "branchId");
    for (const [k, v] of fd.entries()) {
      if (!k.startsWith("route:")) continue;
      await setCategoryRoute(ctx, { branchId, categoryId: k.slice(6), stationId: String(v) || null });
    }
    revalidatePath(path(slug));
  }, "Routing saved");
}

export async function createPrinterAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ bridgeKey: string | null }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const res = await createPrinter(ctx, {
      branchId: s(fd, "branchId"),
      name: s(fd, "name"),
      stationId: s(fd, "stationId") || null,
      connection: s(fd, "connection") as PrinterConnection,
      paperWidthMm: Number(s(fd, "paperWidthMm")),
      copies: Number(s(fd, "copies") || "1"),
    });
    revalidatePath(path(slug));
    return { bridgeKey: res.bridgeKey };
  });
}

export async function setPrinterActiveAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setPrinterActive(ctx, { printerId: s(fd, "printerId"), active: s(fd, "active") === "true" });
    revalidatePath(path(slug));
  });
}

export async function rotateKeyAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ bridgeKey: string | null }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    return { bridgeKey: await rotateBridgeKey(ctx, { printerId: s(fd, "printerId") }) };
  });
}
