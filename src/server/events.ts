// Branch change feed. Writers insert a BranchEvent row INSIDE the same transaction
// as the change, then call `signalBranch` after commit. Readers (SSE streams,
// polling clients) fetch rows with id > their cursor, so a client that was
// offline simply catches up from its last cursor. The in-process signal only
// shortens latency; correctness never depends on it (multi-instance safe).
import { EventEmitter } from "node:events";
import type { Tx } from "./db";

export type BranchEventType =
  | "order.created"
  | "order.updated"
  | "ticket.updated"
  | "service.created"
  | "service.updated"
  | "payment.recorded"
  | "table.updated"
  | "menu.updated";

export async function recordBranchEvent(
  tx: Tx,
  e: { tenantId: string; branchId: string; type: BranchEventType; entityId: string },
): Promise<void> {
  await tx.branchEvent.create({ data: e });
}

const globalForEvents = globalThis as unknown as { __zawliBranchSignals?: EventEmitter };
const emitter = globalForEvents.__zawliBranchSignals ?? new EventEmitter();
emitter.setMaxListeners(0);
globalForEvents.__zawliBranchSignals = emitter;

export function signalBranch(branchId: string): void {
  emitter.emit(`branch:${branchId}`);
}

/** Resolves when the branch is signalled or after `timeoutMs`, whichever is first. */
export function waitForBranchSignal(branchIds: string[], timeoutMs: number, abort?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      for (const id of branchIds) emitter.off(`branch:${id}`, done);
      abort?.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, timeoutMs);
    for (const id of branchIds) emitter.on(`branch:${id}`, done);
    abort?.addEventListener("abort", done);
  });
}
