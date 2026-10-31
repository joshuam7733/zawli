import { timingSafeEqual } from "node:crypto";
import { sweepMobileMoney } from "@/server/services/mobile-money";

/**
 * Re-checks pending mobile money payments and cancels unpaid pay-first orders.
 * The app also runs this every 20 s in-process (src/instrumentation.ts); call it
 * from an external scheduler when running several instances or serverless.
 * Auth: Authorization: Bearer $CRON_SECRET
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await sweepMobileMoney(), { headers: { "Cache-Control": "no-store" } });
}
