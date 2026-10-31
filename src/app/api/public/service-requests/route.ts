import { enforceRateLimit, handle, json, readJson } from "@/server/api";
import { createServiceRequest } from "@/server/services/ordering";

/** Waiter call / bill request from the table. */
export async function POST(req: Request) {
  return handle(req, async () => {
    const body = await readJson<{ token: string; type: "ASSISTANCE" | "BILL"; note?: string }>(req, 4_000);
    enforceRateLimit(req, "service:ip", 12, 10 * 60_000, String(body?.token ?? "").slice(0, 64));
    const res = await createServiceRequest(body);
    return json(res, { status: res.duplicate ? 200 : 201 });
  });
}
