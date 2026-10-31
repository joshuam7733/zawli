import { apiTenantContext, enforceRateLimit, handle, json } from "@/server/api";
import { can, requireWritable } from "@/server/authz";
import { AppError, forbidden } from "@/server/errors";
import { MAX_IMAGE_BYTES, saveImage } from "@/server/storage";

export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  return handle(req, async () => {
    const { tenant } = await params;
    const ctx = await apiTenantContext(tenant);
    if (!can(ctx, "menu.manage") && !can(ctx, "tenant.settings.manage")) throw forbidden();
    requireWritable(ctx);
    enforceRateLimit(req, "upload", 30, 10 * 60_000, ctx.user.id);
    const len = Number(req.headers.get("content-length") ?? "0");
    if (len > MAX_IMAGE_BYTES + 64_000) throw new AppError("VALIDATION", "Images must be 2 MB or smaller.");
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("VALIDATION", "Choose an image to upload.");
    const url = await saveImage(ctx.tenant.id, new Uint8Array(await file.arrayBuffer()));
    return json({ url });
  });
}
