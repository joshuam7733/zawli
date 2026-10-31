// Dining tables and QR tokens (restaurant side).
import { z } from "zod";
import { db } from "../db";
import { can, requirePermission, requireWritable, branchesWith, type TenantContext } from "../authz";
import { conflict, isUniqueViolation, notFound } from "../errors";
import { writeAudit } from "../audit";
import { recordBranchEvent, signalBranch } from "../events";
import { randomToken } from "../tokens";
import { idSchema, optionalText } from "../validation";

export function qrUrl(token: string): string {
  const base = process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/t/${token}`;
}

export async function listTables(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "orders.view", branchId);
  const tables = await db.diningTable.findMany({
    where: { tenantId: ctx.tenant.id, branchId },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: {
      qrTokens: { where: { status: "ACTIVE" }, select: { id: true, token: true, createdAt: true } },
      sessions: { where: { status: "OPEN" }, select: { id: true, openedAt: true, lastActivityAt: true } },
      _count: { select: { orders: true } },
    },
  });
  return tables.map((t) => ({ ...t, qr: t.qrTokens[0] ?? null, openSession: t.sessions[0] ?? null }));
}

export const tableInputSchema = z.object({
  branchId: idSchema,
  label: z.string().trim().min(1, "Enter a table label.").max(20),
  area: optionalText(40),
  seats: z.coerce.number().int().min(1).max(100).optional().nullable(),
});

export async function createTable(ctx: TenantContext, input: z.input<typeof tableInputSchema>) {
  const data = tableInputSchema.parse(input);
  requirePermission(ctx, "tables.manage", data.branchId);
  requireWritable(ctx);
  try {
    return await db.$transaction(async (tx) => {
      const branch = await tx.branch.findFirst({ where: { id: data.branchId, tenantId: ctx.tenant.id } });
      if (!branch) throw notFound("Branch");
      const count = await tx.diningTable.count({ where: { branchId: branch.id } });
      const table = await tx.diningTable.create({
        data: {
          tenantId: ctx.tenant.id,
          branchId: branch.id,
          label: data.label,
          area: data.area,
          seats: data.seats ?? null,
          sortOrder: count,
        },
      });
      // Every new table gets a QR token straight away.
      await tx.tableQrToken.create({
        data: { tenantId: ctx.tenant.id, branchId: branch.id, tableId: table.id, token: randomToken() },
      });
      await writeAudit(tx, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        action: "table.created",
        entityType: "DiningTable",
        entityId: table.id,
        metadata: { label: table.label },
      });
      return table;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A table with this label already exists at this branch.");
    throw e;
  }
}

export const updateTableSchema = tableInputSchema.omit({ branchId: true }).extend({
  tableId: idSchema,
  isActive: z.boolean().optional(),
});

export async function updateTable(ctx: TenantContext, input: z.input<typeof updateTableSchema>) {
  const data = updateTableSchema.parse(input);
  const table = await db.diningTable.findFirst({ where: { id: data.tableId, tenantId: ctx.tenant.id } });
  if (!table) throw notFound("Table");
  requirePermission(ctx, "tables.manage", table.branchId);
  requireWritable(ctx);
  try {
    await db.$transaction(async (tx) => {
      await tx.diningTable.update({
        where: { id: table.id },
        data: { label: data.label, area: data.area, seats: data.seats ?? null, isActive: data.isActive },
      });
      if (data.isActive === false) {
        // Deactivating a table closes its open session.
        await tx.tableSession.updateMany({
          where: { tableId: table.id, status: "OPEN" },
          data: { status: "CLOSED", closedAt: new Date(), closeReason: "Table deactivated" },
        });
      }
      await recordBranchEvent(tx, {
        tenantId: ctx.tenant.id,
        branchId: table.branchId,
        type: "table.updated",
        entityId: table.id,
      });
      await writeAudit(tx, {
        tenantId: ctx.tenant.id,
        actorId: ctx.user.id,
        action: "table.updated",
        entityType: "DiningTable",
        entityId: table.id,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw conflict("A table with this label already exists at this branch.");
    throw e;
  }
  signalBranch(table.branchId);
}

/**
 * Revokes the table's active QR token and issues a new one (e.g. a code was
 * photographed and misused). Printed codes with the old token stop working at once.
 */
export async function regenerateTableQr(ctx: TenantContext, input: { tableId: string }) {
  const tableId = idSchema.parse(input.tableId);
  const table = await db.diningTable.findFirst({ where: { id: tableId, tenantId: ctx.tenant.id } });
  if (!table) throw notFound("Table");
  requirePermission(ctx, "tables.manage", table.branchId);
  requireWritable(ctx);
  return db.$transaction(async (tx) => {
    const revoked = await tx.tableQrToken.updateMany({
      where: { tableId: table.id, tenantId: ctx.tenant.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    const qr = await tx.tableQrToken.create({
      data: { tenantId: ctx.tenant.id, branchId: table.branchId, tableId: table.id, token: randomToken() },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "table.qr_regenerated",
      entityType: "DiningTable",
      entityId: table.id,
      metadata: { revokedCount: revoked.count },
    });
    return qr;
  });
}

/** Revokes without replacement: the table can no longer be ordered from by QR. */
export async function revokeTableQr(ctx: TenantContext, input: { tableId: string }) {
  const tableId = idSchema.parse(input.tableId);
  const table = await db.diningTable.findFirst({ where: { id: tableId, tenantId: ctx.tenant.id } });
  if (!table) throw notFound("Table");
  requirePermission(ctx, "tables.manage", table.branchId);
  requireWritable(ctx);
  await db.$transaction(async (tx) => {
    await tx.tableQrToken.updateMany({
      where: { tableId: table.id, tenantId: ctx.tenant.id, status: "ACTIVE" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "table.qr_revoked",
      entityType: "DiningTable",
      entityId: table.id,
    });
  });
}

/** Closes an open table session (after the guests leave / have paid). */
export async function closeTableSession(ctx: TenantContext, input: { sessionId: string; reason?: string }) {
  const sessionId = idSchema.parse(input.sessionId);
  const session = await db.tableSession.findFirst({ where: { id: sessionId, tenantId: ctx.tenant.id } });
  if (!session) throw notFound("Table session");
  requirePermission(ctx, "orders.serve", session.branchId);
  requireWritable(ctx);
  if (session.status !== "OPEN") return;
  await db.$transaction(async (tx) => {
    await tx.tableSession.update({
      where: { id: session.id },
      data: { status: "CLOSED", closedAt: new Date(), closeReason: input.reason?.slice(0, 200) || "Closed by staff" },
    });
    await tx.serviceRequest.updateMany({
      where: { tableSessionId: session.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: { status: "CANCELLED" },
    });
    await recordBranchEvent(tx, {
      tenantId: ctx.tenant.id,
      branchId: session.branchId,
      type: "table.updated",
      entityId: session.tableId,
    });
  });
  signalBranch(session.branchId);
}

/** Tables + active QR tokens for a printable sheet, limited to permitted branches. */
export async function getQrSheet(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "tables.manage", branchId);
  const branch = await db.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  const tables = await db.diningTable.findMany({
    where: { tenantId: ctx.tenant.id, branchId, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { label: "asc" }],
    include: { qrTokens: { where: { status: "ACTIVE" } } },
  });
  return {
    branch,
    tables: tables.filter((t) => t.qrTokens.length > 0).map((t) => ({ ...t, url: qrUrl(t.qrTokens[0].token) })),
  };
}

export function canManageTables(ctx: TenantContext): boolean {
  return can(ctx, "tables.manage") || branchesWith(ctx, "tables.manage").length > 0;
}
