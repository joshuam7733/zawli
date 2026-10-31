import { apiTenantContext, errorResponse } from "@/server/api";
import { requirePermission } from "@/server/authz";
import { db } from "@/server/db";
import { notFound } from "@/server/errors";
import { qrPng, qrSvg } from "@/server/qr";
import { qrUrl } from "@/server/services/tables";

/** Downloadable QR code for one table (PNG for printing services, SVG for designers). */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; id: string }> }) {
  try {
    const { tenant, id } = await params;
    const ctx = await apiTenantContext(tenant);
    const table = await db.diningTable.findFirst({
      where: { id, tenantId: ctx.tenant.id },
      include: { qrTokens: { where: { status: "ACTIVE" } }, branch: { select: { slug: true } } },
    });
    if (!table || table.qrTokens.length === 0) throw notFound("QR code");
    requirePermission(ctx, "tables.manage", table.branchId);
    const url = qrUrl(table.qrTokens[0].token);
    const format = new URL(req.url).searchParams.get("format") === "svg" ? "svg" : "png";
    const filename = `${ctx.tenant.slug}-${table.branch.slug}-table-${table.label}`.replace(/[^A-Za-z0-9_-]+/g, "-");
    const headers = {
      "Content-Disposition": `attachment; filename="${filename}.${format}"`,
      "Cache-Control": "no-store",
    };
    if (format === "svg")
      return new Response(await qrSvg(url), { headers: { ...headers, "Content-Type": "image/svg+xml" } });
    return new Response(new Uint8Array(await qrPng(url)), { headers: { ...headers, "Content-Type": "image/png" } });
  } catch (e) {
    return errorResponse(e);
  }
}
