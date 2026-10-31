// Role → permission matrix. Enforced on the server (src/server/authz). The UI may
// hide controls using the same matrix, but hiding is never the security boundary.
import type { FulfillmentMode, PlatformRole, TenantRole } from "@/generated/prisma/enums";

export type TenantPermission =
  | "tenant.settings.manage"
  | "tenant.billing.view"
  | "tenant.audit.view"
  | "branch.manage"
  | "staff.manage"
  | "menu.manage"
  | "menu.availability"
  | "tables.manage"
  | "printing.manage"
  | "orders.view"
  | "orders.kitchen"
  | "orders.serve"
  | "orders.cancel"
  | "payments.view"
  | "payments.record"
  | "payments.void"
  | "service.handle"
  | "reports.view";

/** Permissions that apply to the whole tenant (not one branch). */
export const TENANT_WIDE_PERMISSIONS: ReadonlySet<TenantPermission> = new Set([
  "tenant.settings.manage",
  "tenant.billing.view",
  "tenant.audit.view",
  "branch.manage",
  "staff.manage",
  "menu.manage",
]);

const ROLE_PERMISSIONS: Record<TenantRole, ReadonlySet<TenantPermission>> = {
  RESTAURANT_OWNER: new Set<TenantPermission>([
    "tenant.settings.manage",
    "tenant.billing.view",
    "tenant.audit.view",
    "branch.manage",
    "staff.manage",
    "menu.manage",
    "menu.availability",
    "tables.manage",
    "printing.manage",
    "orders.view",
    "orders.kitchen",
    "orders.serve",
    "orders.cancel",
    "payments.view",
    "payments.record",
    "payments.void",
    "service.handle",
    "reports.view",
  ]),
  MANAGER: new Set<TenantPermission>([
    "staff.manage",
    "menu.manage",
    "menu.availability",
    "tables.manage",
    "printing.manage",
    "orders.view",
    "orders.kitchen",
    "orders.serve",
    "orders.cancel",
    "payments.view",
    "payments.record",
    "payments.void",
    "service.handle",
    "reports.view",
  ]),
  // Waiters record money received at the table but cannot void payments or see reports.
  WAITER: new Set<TenantPermission>([
    "orders.view",
    "orders.serve",
    "payments.view",
    "payments.record",
    "service.handle",
  ]),
  // Kitchen staff see and progress tickets only. No payment or financial data.
  KITCHEN: new Set<TenantPermission>(["orders.view", "orders.kitchen", "menu.availability"]),
};

export function roleHasPermission(role: TenantRole, permission: TenantPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

/**
 * In PRINTER and MANUAL fulfillment modes there may be no kitchen screen, so floor
 * staff (waiters) are also allowed to progress tickets from the order queue.
 */
export function roleCanProgressKitchen(role: TenantRole, mode: FulfillmentMode): boolean {
  if (roleHasPermission(role, "orders.kitchen")) return true;
  return role === "WAITER" && (mode === "PRINTER" || mode === "MANUAL");
}

/** Roles a member with `actor` role may assign to other staff. Owners are created by the platform. */
export function assignableRoles(actor: TenantRole): TenantRole[] {
  if (actor === "RESTAURANT_OWNER") return ["MANAGER", "WAITER", "KITCHEN"];
  if (actor === "MANAGER") return ["WAITER", "KITCHEN"];
  return [];
}

export const ROLE_LABELS: Record<TenantRole, string> = {
  RESTAURANT_OWNER: "Owner",
  MANAGER: "Manager",
  WAITER: "Waiter",
  KITCHEN: "Kitchen",
};

// ── Platform ──

export type PlatformPermission =
  | "platform.tenants.view"
  | "platform.tenants.manage"
  | "platform.billing.view"
  | "platform.billing.manage"
  | "platform.plans.manage"
  | "platform.audit.view"
  | "platform.settings.manage";

const PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, ReadonlySet<PlatformPermission>> = {
  SUPER_ADMIN: new Set<PlatformPermission>([
    "platform.tenants.view",
    "platform.tenants.manage",
    "platform.billing.view",
    "platform.billing.manage",
    "platform.plans.manage",
    "platform.audit.view",
    "platform.settings.manage",
  ]),
  PLATFORM_BILLING: new Set<PlatformPermission>([
    "platform.tenants.view",
    "platform.billing.view",
    "platform.billing.manage",
  ]),
  PLATFORM_SUPPORT: new Set<PlatformPermission>([
    "platform.tenants.view",
    "platform.billing.view",
    "platform.audit.view",
  ]),
};

export function platformRoleHasPermission(role: PlatformRole | null | undefined, p: PlatformPermission): boolean {
  if (!role) return false;
  return PLATFORM_ROLE_PERMISSIONS[role].has(p);
}
