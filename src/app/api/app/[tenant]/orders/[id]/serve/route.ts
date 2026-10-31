import { apiTenantContext, handle, json, readJson } from "@/server/api";
import { markOrderServing } from "@/server/services/orders";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  return handle(req, async () => {
    const { tenant, id } = await params;
    const ctx = await apiTenantContext(tenant);
    const body = await readJson<{ to: "OUT_FOR_DELIVERY" | "SERVED" }>(req, 1_000);
    return json(await markOrderServing(ctx, { orderId: id, to: body.to }));
  });
}
