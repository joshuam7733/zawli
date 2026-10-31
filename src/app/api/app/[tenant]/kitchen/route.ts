import { apiTenantContext, errorResponse, json } from "@/server/api";
import { getKitchenBoard } from "@/server/services/orders";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params;
    const ctx = await apiTenantContext(tenant);
    const sp = new URL(req.url).searchParams;
    return json(await getKitchenBoard(ctx, { branchId: sp.get("branch") ?? "", stationId: sp.get("station") || null }));
  } catch (e) {
    return errorResponse(e);
  }
}
