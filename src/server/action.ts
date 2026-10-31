import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { isAppError } from "./errors";
import { logError } from "./log";

export type ActionResult<T = unknown> =
  { ok: true; data?: T; message?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

export const IDLE: ActionResult = { ok: true };

/**
 * Runs a server action body and converts known failures into a serialisable
 * result for forms. Unknown errors are logged server-side and shown generically.
 */
export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message };
  } catch (e) {
    unstable_rethrow(e); // let redirect()/notFound() through
    return toActionError(e);
  }
}

export function toActionError(e: unknown): { ok: false; error: string; fieldErrors?: Record<string, string> } {
  if (isAppError(e)) return { ok: false, error: e.message };
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of e.issues) {
      const key = issue.path.join(".") || "_";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: e.issues[0]?.message ?? "Please check the form.", fieldErrors };
  }
  logError("action.unhandled", e);
  return { ok: false, error: "Something went wrong on our side. Please try again." };
}

/** Reads a FormData into a plain object (repeated keys become arrays). */
export function formToObject(fd: FormData): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of fd.entries()) {
    if (typeof v !== "string") continue;
    if (k.startsWith("$ACTION")) continue;
    const prev = out[k];
    if (prev === undefined) out[k] = v;
    else out[k] = Array.isArray(prev) ? [...prev, v] : [prev, v];
  }
  return out;
}
