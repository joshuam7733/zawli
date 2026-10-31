// Restaurant staff: invitations, roles, branch assignments, deactivation.
import { z } from "zod";
import { TenantRole } from "@/generated/prisma/enums";
import { assignableRoles } from "@/domain/permissions";
import { db } from "../db";
import { requirePermission, requireWritable, type TenantContext } from "../authz";
import { conflict, forbidden, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import { emailSchema, findOrCreateUserForInvite, issueSetupToken, personNameSchema, setupUrl } from "./accounts";
import { idSchema } from "../validation";

export async function listStaff(ctx: TenantContext) {
  requirePermission(ctx, "staff.manage");
  const members = await db.membership.findMany({
    where: { tenantId: ctx.tenant.id },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { createdAt: "asc" }],
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          lastLoginAt: true,
          isActive: true,
          accounts: { where: { providerId: "credential" }, select: { password: true } },
        },
      },
      branchAssignments: { include: { branch: { select: { id: true, name: true } } } },
    },
  });
  return members.map((m) => ({
    id: m.id,
    role: m.role,
    allBranches: m.allBranches,
    isActive: m.isActive,
    createdAt: m.createdAt,
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      lastLoginAt: m.user.lastLoginAt,
      hasPassword: m.user.accounts.some((a) => !!a.password),
    },
    branches: m.branchAssignments.map((a) => ({ id: a.branch.id, name: a.branch.name, role: a.role })),
  }));
}

export const inviteStaffSchema = z.object({
  name: personNameSchema,
  email: emailSchema,
  role: z.enum(TenantRole),
  /** Empty = all branches (owners/managers with tenant-wide scope only). */
  branchIds: z.array(idSchema).max(50).default([]),
});

function assertCanAssign(ctx: TenantContext, role: TenantRole) {
  if (!assignableRoles(ctx.membership.role).includes(role)) throw forbidden("You cannot assign this role.");
}

export async function inviteStaff(ctx: TenantContext, input: z.input<typeof inviteStaffSchema>) {
  requirePermission(ctx, "staff.manage");
  requireWritable(ctx);
  const data = inviteStaffSchema.parse(input);
  assertCanAssign(ctx, data.role);
  const allBranches = data.branchIds.length === 0;
  if (allBranches && data.role !== "MANAGER") {
    throw validation("Choose at least one branch for waiters and kitchen staff.");
  }
  const branches = await db.branch.findMany({ where: { tenantId: ctx.tenant.id, id: { in: data.branchIds } } });
  if (branches.length !== new Set(data.branchIds).size) throw notFound("Branch");

  return db.$transaction(async (tx) => {
    const invited = await findOrCreateUserForInvite(tx, {
      email: data.email,
      name: data.name,
      createdById: ctx.user.id,
    });
    const existing = await tx.membership.findUnique({
      where: { tenantId_userId: { tenantId: ctx.tenant.id, userId: invited.userId } },
    });
    if (existing) throw conflict("This person is already a member of your restaurant.");
    const membership = await tx.membership.create({
      data: { tenantId: ctx.tenant.id, userId: invited.userId, role: data.role, allBranches },
    });
    if (!allBranches) {
      await tx.staffBranchAssignment.createMany({
        data: branches.map((b) => ({
          tenantId: ctx.tenant.id,
          membershipId: membership.id,
          branchId: b.id,
          role: data.role,
        })),
      });
    }
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "staff.invited",
      entityType: "Membership",
      entityId: membership.id,
      metadata: { email: data.email, role: data.role, branches: branches.map((b) => b.name) },
    });
    return { membershipId: membership.id, setupUrl: invited.setupToken ? setupUrl(invited.setupToken) : null };
  });
}

export const updateStaffSchema = z.object({
  membershipId: idSchema,
  role: z.enum(TenantRole),
  branches: z.array(z.object({ branchId: idSchema, role: z.enum(TenantRole) })).max(50),
  allBranches: z.boolean().default(false),
});

/** Changes a member's role and per-branch roles. Owners can only be changed by the platform. */
export async function updateStaff(ctx: TenantContext, input: z.input<typeof updateStaffSchema>) {
  requirePermission(ctx, "staff.manage");
  requireWritable(ctx);
  const data = updateStaffSchema.parse(input);
  const m = await db.membership.findFirst({ where: { id: data.membershipId, tenantId: ctx.tenant.id } });
  if (!m) throw notFound("Staff member");
  if (m.role === "RESTAURANT_OWNER") throw forbidden("Owner accounts are managed by the platform administrator.");
  if (m.userId === ctx.user.id) throw forbidden("You cannot change your own role.");
  assertCanAssign(ctx, m.role); // may I manage this person at all?
  assertCanAssign(ctx, data.role);
  for (const b of data.branches) assertCanAssign(ctx, b.role);
  if (data.allBranches && data.role !== "MANAGER") throw validation("Only managers can cover all branches.");
  if (!data.allBranches && data.branches.length === 0) throw validation("Assign at least one branch.");
  const ids = data.branches.map((b) => b.branchId);
  if (new Set(ids).size !== ids.length) throw validation("A branch is listed twice.");
  const count = await db.branch.count({ where: { tenantId: ctx.tenant.id, id: { in: ids } } });
  if (count !== ids.length) throw notFound("Branch");

  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { role: data.role, allBranches: data.allBranches } });
    await tx.staffBranchAssignment.deleteMany({ where: { membershipId: m.id, tenantId: ctx.tenant.id } });
    if (!data.allBranches) {
      await tx.staffBranchAssignment.createMany({
        data: data.branches.map((b) => ({
          tenantId: ctx.tenant.id,
          membershipId: m.id,
          branchId: b.branchId,
          role: b.role,
        })),
      });
    }
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "staff.updated",
      entityType: "Membership",
      entityId: m.id,
      metadata: { role: data.role, allBranches: data.allBranches, branches: data.branches },
    });
  });
}

export async function setStaffActive(ctx: TenantContext, input: { membershipId: string; active: boolean }) {
  requirePermission(ctx, "staff.manage");
  requireWritable(ctx);
  const m = await db.membership.findFirst({
    where: { id: idSchema.parse(input.membershipId), tenantId: ctx.tenant.id },
  });
  if (!m) throw notFound("Staff member");
  if (m.role === "RESTAURANT_OWNER") throw forbidden("Owner accounts are managed by the platform administrator.");
  if (m.userId === ctx.user.id) throw forbidden("You cannot deactivate yourself.");
  assertCanAssign(ctx, m.role);
  await db.$transaction(async (tx) => {
    await tx.membership.update({ where: { id: m.id }, data: { isActive: input.active } });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: input.active ? "staff.reactivated" : "staff.deactivated",
      entityType: "Membership",
      entityId: m.id,
    });
  });
}

/** New one-time setup link for a member who has not set a password yet (or forgot it). */
export async function reissueStaffSetupLink(ctx: TenantContext, input: { membershipId: string }) {
  requirePermission(ctx, "staff.manage");
  requireWritable(ctx);
  const m = await db.membership.findFirst({
    where: { id: idSchema.parse(input.membershipId), tenantId: ctx.tenant.id },
  });
  if (!m) throw notFound("Staff member");
  if (m.role === "RESTAURANT_OWNER") throw forbidden("Owner accounts are managed by the platform administrator.");
  assertCanAssign(ctx, m.role);
  // A user may belong to several restaurants: only reset if this tenant is their only membership.
  const others = await db.membership.count({ where: { userId: m.userId, tenantId: { not: ctx.tenant.id } } });
  if (others > 0)
    throw forbidden("This person also works at another restaurant. Ask them to use their existing password.");
  return db.$transaction(async (tx) => {
    const token = await issueSetupToken(tx, m.userId, ctx.user.id);
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "staff.setup_link_issued",
      entityType: "Membership",
      entityId: m.id,
    });
    return setupUrl(token);
  });
}
