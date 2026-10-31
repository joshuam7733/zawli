import type { Prisma } from "@/generated/prisma/client";
import type { Tx } from "./db";

export interface AuditEntry {
  tenantId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  /** Small, non-sensitive context. Never include passwords, tokens or secrets. */
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

const SENSITIVE_KEY = /pass(word)?|secret|token|hash|authorization|cookie/i;

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrub(v);
    return out;
  }
  return value;
}

export async function writeAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: entry.tenantId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata === undefined ? undefined : (scrub(entry.metadata) as Prisma.InputJsonValue),
      ipAddress: entry.ipAddress ?? null,
    },
  });
}
