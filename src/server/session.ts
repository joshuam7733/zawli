import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import { db } from "./db";
import {
  loadTenantContext,
  requirePlatform,
  type PlatformContext,
  type SessionUser,
  type TenantContext,
} from "./authz";
import type { PlatformPermission } from "@/domain/permissions";
import { isAppError } from "./errors";

/** The signed-in, active user for this request (memoised per request). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, platformRole: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole };
});

/** For pages: redirects to /login when signed out. */
export async function requireUserPage(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export const getTenantContext = cache(async (tenantSlug: string): Promise<TenantContext> => {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return loadTenantContext(user, tenantSlug);
});

/** For pages: tenant context or the not-found page (never reveals other tenants). */
export async function requireTenantPage(tenantSlug: string): Promise<TenantContext> {
  try {
    return await getTenantContext(tenantSlug);
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "TENANT_SUSPENDED")) notFound();
    throw e;
  }
}

export async function requirePlatformPage(permission: PlatformPermission): Promise<PlatformContext> {
  const user = await requireUserPage();
  try {
    return requirePlatform(user, permission);
  } catch {
    // Restaurant staff get a plain 404: platform routes are not advertised.
    notFound();
  }
}
