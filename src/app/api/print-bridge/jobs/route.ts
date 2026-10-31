import { enforceRateLimit, errorResponse, json } from "@/server/api";
import { bridgeFetchJobs } from "@/server/services/printing";

export const dynamic = "force-dynamic";

/**
 * Print bridge pull endpoint. A helper on the restaurant network polls this with
 * `Authorization: Bearer zpb_…` and receives plain-text tickets to print.
 */
export async function GET(req: Request) {
  try {
    enforceRateLimit(req, "print-bridge", 120, 60_000);
    const key = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? null;
    return json({ jobs: await bridgeFetchJobs(key) });
  } catch (e) {
    return errorResponse(e);
  }
}
