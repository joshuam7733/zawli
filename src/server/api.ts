import "server-only";
import { ZodError } from "zod";
import { AppError, isAppError, unauthenticated } from "./errors";
import { loadTenantContext, type TenantContext } from "./authz";
import { getSessionUser } from "./session";
import { logError } from "./log";
import { clientIp, rateLimit } from "./rate-limit";

export function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function errorResponse(e: unknown): Response {
  if (isAppError(e)) {
    const headers: Record<string, string> = {};
    if (e.code === "RATE_LIMITED" && typeof e.details === "number") headers["Retry-After"] = String(e.details);
    return json(
      { error: { code: e.code, message: e.message, details: e.code === "VALIDATION" ? e.details : undefined } },
      { status: e.status, headers },
    );
  }
  if (e instanceof ZodError) {
    return json(
      { error: { code: "VALIDATION", message: e.issues[0]?.message ?? "Invalid request." } },
      { status: 422 },
    );
  }
  logError("api.unhandled", e);
  return json(
    { error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } },
    { status: 500 },
  );
}

/**
 * CSRF defence for cookie-authenticated (and public) mutations: the browser's
 * Origin (or Referer) must match this host. Server Actions get the same check
 * from Next.js itself.
 */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const origin = req.headers.get("origin") ?? req.headers.get("referer");
  if (!host || !origin) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("FORBIDDEN", "Cross-site request blocked.");
  }
  if (originHost !== host) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

export function enforceRateLimit(req: Request, bucket: string, limit: number, windowMs: number, extraKey = "") {
  const r = rateLimit(`${bucket}:${clientIp(req.headers)}:${extraKey}`, limit, windowMs);
  if (!r.ok)
    throw new AppError("RATE_LIMITED", "Too many requests. Please wait a moment and try again.", r.retryAfterSeconds);
}

/** Tenant context for API routes (JSON errors instead of redirects). */
export async function apiTenantContext(tenantSlug: string): Promise<TenantContext> {
  const user = await getSessionUser();
  if (!user) throw unauthenticated();
  return loadTenantContext(user, tenantSlug);
}

export async function readJson<T = unknown>(req: Request, maxBytes = 64_000): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("VALIDATION", "Request too large.");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("VALIDATION", "Invalid JSON.");
  }
}

export async function handle(req: Request, fn: () => Promise<Response>): Promise<Response> {
  try {
    assertSameOrigin(req);
    return await fn();
  } catch (e) {
    return errorResponse(e);
  }
}
