import { apiTenantContext, errorResponse, json } from "@/server/api";
import { getFloorBoard } from "@/server/services/floor";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params;
    const ctx = await apiTenantContext(tenant);
    return json(await getFloorBoard(ctx, new URL(req.url).searchParams.get("branch") ?? ""));
  } catch (e) {
    return errorResponse(e);
  }
}
