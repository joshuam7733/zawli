import { enforceRateLimit, handle, json, readJson } from "@/server/api";
import { startMobileMoneyPayment } from "@/server/services/mobile-money";

/** Guest starts a mobile money payment (MTN MoMo / Airtel Money) for a pay-first order. */
export async function POST(req: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  return handle(req, async () => {
    const { publicToken } = await params;
    enforceRateLimit(req, "pay:ip", 20, 10 * 60_000);
    enforceRateLimit(req, "pay:order", 8, 10 * 60_000, publicToken.slice(0, 64));
    const body = await readJson<{ provider: string; phone: string }>(req, 2_000);
    return json(
      await startMobileMoneyPayment({ publicToken, provider: body?.provider as never, phone: body?.phone ?? "" }),
    );
  });
}
