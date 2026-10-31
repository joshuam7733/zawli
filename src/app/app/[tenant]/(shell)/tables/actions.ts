"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import {
  closeTableSession,
  createTable,
  regenerateTableQr,
  revokeTableQr,
  updateTable,
} from "@/server/services/tables";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const seats = (fd: FormData) => (s(fd, "seats") ? Number(s(fd, "seats")) : null);

export async function createTableAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await createTable(ctx, {
      branchId: s(fd, "branchId"),
      label: s(fd, "label"),
      area: s(fd, "area"),
      seats: seats(fd),
    });
    revalidatePath(`/app/${slug}/tables`);
  }, "Table added with a new QR code");
}

export async function updateTableAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateTable(ctx, { tableId: s(fd, "tableId"), label: s(fd, "label"), area: s(fd, "area"), seats: seats(fd) });
    revalidatePath(`/app/${slug}/tables`);
  }, "Table saved");
}

export async function setTableActiveAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await updateTable(ctx, {
      tableId: s(fd, "tableId"),
      label: s(fd, "label"),
      area: s(fd, "area") || null,
      seats: seats(fd),
      isActive: s(fd, "active") === "true",
    });
    revalidatePath(`/app/${slug}/tables`);
  });
}

export async function regenerateQrAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await regenerateTableQr(ctx, { tableId: s(fd, "tableId") });
    revalidatePath(`/app/${slug}/tables`);
  });
}

export async function revokeQrAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await revokeTableQr(ctx, { tableId: s(fd, "tableId") });
    revalidatePath(`/app/${slug}/tables`);
  });
}

export async function closeSessionAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await closeTableSession(ctx, { sessionId: s(fd, "sessionId") });
    revalidatePath(`/app/${slug}/tables`);
    revalidatePath(`/app/${slug}/floor`);
  });
}
