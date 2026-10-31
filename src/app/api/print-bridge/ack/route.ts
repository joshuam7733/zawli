import { enforceRateLimit, errorResponse, json, readJson } from "@/server/api";
import { bridgeAck } from "@/server/services/printing";

/** The bridge reports success/failure for a job. Machine-to-machine: bearer key, no cookies. */
export async function POST(req: Request) {
  try {
    enforceRateLimit(req, "print-bridge", 120, 60_000);
    const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    const body = await readJson<{ jobId: string; ok: boolean; error?: string }>(req, 2_000);
    return json(await bridgeAck(key, body));
  } catch (e) {
    return errorResponse(e);
  }
}
