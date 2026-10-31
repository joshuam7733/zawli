import { apiTenantContext, errorResponse } from "@/server/api";
import { loadTenantContext, requirePermission } from "@/server/authz";
import { db } from "@/server/db";
import { waitForBranchSignal } from "@/server/events";
import { validation } from "@/server/errors";

export const dynamic = "force-dynamic";

const MAX_STREAM_MS = 10 * 60_000; // clients reconnect automatically (Last-Event-ID)
const RECHECK_MS = 60_000; // re-verify membership while streaming
const WAIT_MS = 15_000; // max time between database checks (multi-instance safe)

/**
 * Server-Sent Events change feed for one branch. Each event only says "something
 * changed" (type + id); clients refetch their board from the API, so the database
 * stays the source of truth and missed events are harmless.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  try {
    const { tenant } = await params;
    const ctx = await apiTenantContext(tenant);
    const url = new URL(req.url);
    const branchId = url.searchParams.get("branch") ?? "";
    requirePermission(ctx, "orders.view", branchId);
    const fromHeader = req.headers.get("last-event-id");
    const rawCursor = fromHeader ?? url.searchParams.get("cursor") ?? "0";
    if (!/^\d{1,19}$/.test(rawCursor)) throw validation("Invalid cursor.");
    let cursor = BigInt(rawCursor);

    const encoder = new TextEncoder();
    const started = Date.now();
    const stream = new ReadableStream({
      async start(controller) {
        const send = (s: string) => controller.enqueue(encoder.encode(s));
        send(`retry: 3000\n: connected\n\n`);
        let lastCheck = Date.now();
        try {
          while (!req.signal.aborted && Date.now() - started < MAX_STREAM_MS) {
            if (Date.now() - lastCheck > RECHECK_MS) {
              await loadTenantContext(ctx.user, tenant); // throws if access was revoked
              lastCheck = Date.now();
            }
            const events = await db.branchEvent.findMany({
              where: { branchId, tenantId: ctx.tenant.id, id: { gt: cursor } },
              orderBy: { id: "asc" },
              take: 200,
              select: { id: true, type: true, entityId: true },
            });
            if (events.length > 0) {
              cursor = events[events.length - 1].id;
              const payload = JSON.stringify(events.map((e) => ({ type: e.type, id: e.entityId })));
              send(`id: ${cursor}\nevent: change\ndata: ${payload}\n\n`);
            } else {
              send(`: ping\n\n`);
            }
            await waitForBranchSignal([branchId], WAIT_MS, req.signal);
          }
        } catch {
          // client gone or access revoked: end the stream
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
