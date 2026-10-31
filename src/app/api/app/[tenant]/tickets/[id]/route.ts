import { apiTenantContext, handle, json, readJson } from "@/server/api";
import { advanceTicket } from "@/server/services/orders";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  return handle(req, async () => {
    const { tenant, id } = await params;
    const ctx = await apiTenantContext(tenant);
    const body = await readJson<{ to: "ACKNOWLEDGED" | "PREPARING" | "READY" }>(req, 1_000);
    return json(await advanceTicket(ctx, { ticketId: id, to: body.to }));
  });
}
