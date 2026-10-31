"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { inviteStaff, reissueStaffSetupLink, setStaffActive, updateStaff } from "@/server/services/staff";
import type { TenantRole } from "@/generated/prisma/enums";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function inviteStaffAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ setupUrl: string | null }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const role = s(fd, "role") as TenantRole;
    const res = await inviteStaff(ctx, {
      name: s(fd, "name"),
      email: s(fd, "email"),
      role,
      branchIds: fd.get("allBranches") === "on" && role === "MANAGER" ? [] : fd.getAll("branchId").map(String),
    });
    revalidatePath(`/app/${slug}/staff`);
    return { setupUrl: res.setupUrl };
  });
}

export async function updateStaffAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const role = s(fd, "role") as TenantRole;
    const all = fd.get("allBranches") === "on" && role === "MANAGER";
    await updateStaff(ctx, {
      membershipId: s(fd, "membershipId"),
      role,
      allBranches: all,
      branches: all ? [] : fd.getAll("branchId").map((b) => ({ branchId: String(b), role })),
    });
    revalidatePath(`/app/${slug}/staff`);
  }, "Saved");
}

export async function setStaffActiveAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    await setStaffActive(ctx, { membershipId: s(fd, "membershipId"), active: s(fd, "active") === "true" });
    revalidatePath(`/app/${slug}/staff`);
  });
}

export async function reissueLinkAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult<{ setupUrl: string | null }>> {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const url = await reissueStaffSetupLink(ctx, { membershipId: s(fd, "membershipId") });
    return { setupUrl: url };
  });
}
