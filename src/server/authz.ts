// Server-side authorization. Every protected operation resolves a context here
// and checks permissions against it. Never trust tenant/branch ids from the client
// without passing them through these checks.
import type { PlatformRole, TenantRole, TenantStatus } from "@/generated/prisma/enums";
import {
  platformRoleHasPermission,
  roleHasPermission,
  TENANT_WIDE_PERMISSIONS,
  type PlatformPermission,
  type TenantPermission,
} from "@/domain/permissions";
import { db } from "./db";
import { AppError, forbidden, notFound, unauthenticated } from "./errors";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  platformRole: PlatformRole | null;
}

export interface TenantContext {
  user: SessionUser;
  tenant: {
    id: string;
    slug: string;
    name: string;
    status: TenantStatus;
    currency: string;
    timezone: string;
    locale: string;
    isDemo: boolean;
    brandPrimary: string;
    brandAccent: string;
    logoUrl: string | null;
  };
  membership: { id: string; role: TenantRole; allBranches: boolean };
  /** Effective role at each branch this member can access. */
  branchRoles: Map<string, TenantRole>;
}

export interface PlatformContext {
  user: SessionUser & { platformRole: PlatformRole };
}

/**
 * Loads the membership of `userId` in the tenant identified by `tenantSlug`.
 * Throws NOT_FOUND (not FORBIDDEN) when the user is not a member, so tenant
 * existence is not revealed to outsiders.
 */
export async function loadTenantContext(user: SessionUser, tenantSlug: string): Promise<TenantContext> {
  const membership = await db.membership.findFirst({
    where: { userId: user.id, isActive: true, tenant: { slug: tenantSlug } },
    include: {
      tenant: true,
      branchAssignments: { select: { branchId: true, role: true } },
    },
  });
  if (!membership) throw notFound("Restaurant");
  const t = membership.tenant;
  if (t.status === "DEACTIVATED")
    throw new AppError("TENANT_SUSPENDED", "This restaurant account has been deactivated.");

  const branchRoles = new Map<string, TenantRole>();
  if (membership.allBranches) {
    const branches = await db.branch.findMany({ where: { tenantId: t.id }, select: { id: true } });
    for (const b of branches) branchRoles.set(b.id, membership.role);
  } else {
    for (const a of membership.branchAssignments) branchRoles.set(a.branchId, a.role);
  }

  return {
    user,
    tenant: {
      id: t.id,
      slug: t.slug,
      name: t.name,
      status: t.status,
      currency: t.currency,
      timezone: t.timezone,
      locale: t.locale,
      isDemo: t.isDemo,
      brandPrimary: t.brandPrimary,
      brandAccent: t.brandAccent,
      logoUrl: t.logoUrl,
    },
    membership: { id: membership.id, role: membership.role, allBranches: membership.allBranches },
    branchRoles,
  };
}

/** True when the member holds `permission` (tenant-wide, or at `branchId` for branch permissions). */
export function can(ctx: TenantContext, permission: TenantPermission, branchId?: string): boolean {
  if (TENANT_WIDE_PERMISSIONS.has(permission)) {
    const role = ctx.membership.role;
    // Tenant-wide administration needs a tenant-wide membership (owners always have one).
    return roleHasPermission(role, permission) && (ctx.membership.allBranches || role === "RESTAURANT_OWNER");
  }
  if (branchId) {
    const role = ctx.branchRoles.get(branchId);
    return !!role && roleHasPermission(role, permission);
  }
  // No branch given: allowed if the permission is held at ANY accessible branch.
  for (const role of ctx.branchRoles.values()) if (roleHasPermission(role, permission)) return true;
  return false;
}

export function requirePermission(ctx: TenantContext, permission: TenantPermission, branchId?: string): void {
  if (!can(ctx, permission, branchId)) throw forbidden();
}

/** Branch ids where the member holds `permission`. Use to scope list queries. */
export function branchesWith(ctx: TenantContext, permission: TenantPermission): string[] {
  const ids: string[] = [];
  for (const [id, role] of ctx.branchRoles) if (roleHasPermission(role, permission)) ids.push(id);
  return ids;
}

export function roleAt(ctx: TenantContext, branchId: string): TenantRole | null {
  return ctx.branchRoles.get(branchId) ?? null;
}

/**
 * Suspended tenants are read-only (staff can sign in, view and export data).
 * ONBOARDING tenants can be configured but do not accept public orders.
 */
export function requireWritable(ctx: TenantContext): void {
  if (ctx.tenant.status === "SUSPENDED") {
    throw new AppError(
      "TENANT_SUSPENDED",
      "This restaurant account is suspended. Data is read-only — please contact the platform administrator.",
    );
  }
}

export function requirePlatform(user: SessionUser | null, permission: PlatformPermission): PlatformContext {
  if (!user) throw unauthenticated();
  if (!user.platformRole || !platformRoleHasPermission(user.platformRole, permission)) throw forbidden();
  return { user: user as PlatformContext["user"] };
}
