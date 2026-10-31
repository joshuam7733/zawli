import { enforceRateLimit, errorResponse, json } from "@/server/api";
import { notFound } from "@/server/errors";
import { getPublicOrder } from "@/server/services/ordering";

/** Order progress for the ordering device. Only reachable with the unguessable public token. */
export async function GET(req: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  try {
    enforceRateLimit(req, "order-status", 240, 60_000);
    const { publicToken } = await params;
    const order = await getPublicOrder(publicToken);
    if (!order) throw notFound("Order");
    return json(order);
  } catch (e) {
    return errorResponse(e);
  }
}
