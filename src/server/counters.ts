import type { Tx } from "./db";

/**
 * Atomically increments and returns a named counter. Runs inside the caller's
 * transaction; the row lock serialises concurrent callers, so numbers are unique
 * and gap-free per committed transaction.
 */
export async function nextCounterValue(tx: Tx, scope: string): Promise<number> {
  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "Counter" ("scope", "value") VALUES (${scope}, 1)
    ON CONFLICT ("scope") DO UPDATE SET "value" = "Counter"."value" + 1
    RETURNING "value"`;
  return Number(rows[0].value);
}
