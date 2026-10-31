import { enforceRateLimit, handle, json, readJson } from "@/server/api";
import { placeOrder, type PlaceOrderInput } from "@/server/services/ordering";

/** Anonymous customer order submission (QR token is the credential). */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await readJson<PlaceOrderInput>(req);
    enforceRateLimit(req, "order:ip", 30, 10 * 60_000);
    enforceRateLimit(req, "order:token", 60, 10 * 60_000, String(body?.token ?? "").slice(0, 64));
    const res = await placeOrder(body);
    return json(res, { status: res.duplicate ? 200 : 201 });
  });
}
