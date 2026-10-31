import { clientIp, rateLimit } from "@/server/rate-limit";
import { handleProviderCallback } from "@/server/services/mobile-money";

/**
 * Provider callbacks (MTN sends PUT, Airtel sends POST). The body is NOT trusted:
 * we only extract our reference and then ask the provider for the real status.
 */
async function handler(req: Request) {
  const limited = !rateLimit(`pay-callback:${clientIp(req.headers)}`, 120, 60_000).ok;
  if (!limited) {
    let ref = new URL(req.url).searchParams.get("ref");
    if (!ref) {
      try {
        const body = (await req.json()) as { referenceId?: string; externalId?: string; transaction?: { id?: string } };
        ref = body?.transaction?.id ?? body?.externalId ?? body?.referenceId ?? null;
      } catch {
        ref = null;
      }
    }
    await handleProviderCallback(ref && /^[A-Za-z0-9-]{8,64}$/.test(ref) ? ref : null).catch(() => {});
  }
  // Always 200 so providers don't retry forever; our own polling covers misses.
  return new Response(null, { status: 200 });
}

export const POST = handler;
export const PUT = handler;
