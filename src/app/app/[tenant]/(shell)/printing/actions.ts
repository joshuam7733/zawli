"use server";
import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "@/server/action";
import { getTenantContext } from "@/server/session";
import { markPrintJob } from "@/server/services/printing";

export async function markPrintJobAction(slug: string, _p: ActionResult, fd: FormData) {
  return runAction(async () => {
    const ctx = await getTenantContext(slug);
    const outcome = String(fd.get("outcome"));
    await markPrintJob(ctx, {
      jobId: String(fd.get("jobId") ?? ""),
      outcome: outcome === "PRINTED" ? "PRINTED" : outcome === "RETRY" ? "RETRY" : "FAILED",
    });
    revalidatePath(`/app/${slug}/printing`);
  });
}
