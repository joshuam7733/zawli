// Fixed-window rate limiter for public endpoints (QR ordering, waiter calls).
// In-memory: correct for a single app instance. For several instances, swap the
// store for Redis/Postgres behind the same `rateLimit` signature (docs/SECURITY.md).

interface Bucket {
  count: number;
  resetAt: number;
}

const globalForRl = globalThis as unknown as { __zawliRateLimit?: Map<string, Bucket> };
const buckets = globalForRl.__zawliRateLimit ?? new Map<string, Bucket>();
globalForRl.__zawliRateLimit = buckets;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
  if (process.env.ZAWLI_DISABLE_RATE_LIMIT === "1") return { ok: true, remaining: limit, retryAfterSeconds: 0 };
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count += 1;
  if (buckets.size > 50_000) {
    for (const [k, v] of buckets) if (v.resetAt <= now) buckets.delete(k);
  }
  const ok = b.count <= limit;
  return {
    ok,
    remaining: Math.max(0, limit - b.count),
    retryAfterSeconds: ok ? 0 : Math.ceil((b.resetAt - now) / 1000),
  };
}

export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return headers.get("x-real-ip") ?? "unknown";
}
