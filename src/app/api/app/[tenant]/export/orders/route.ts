import { apiTenantContext, errorResponse } from "@/server/api";
import { exportOrdersCsv } from "@/server/services/reports";

/** CSV export of orders (available to owners/managers, also while suspended). */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params;
    const ctx = await apiTenantContext(tenant);
    const days = Math.min(366, Math.max(1, Number(new URL(req.url).searchParams.get("days") ?? "30") || 30));
    const to = new Date(Date.now() + 60_000);
    const from = new Date(to.getTime() - days * 86_400_000);
    const csv = await exportOrdersCsv(ctx, from, to);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${ctx.tenant.slug}-orders-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
