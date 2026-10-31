// Sends a pay-first order to the kitchen once it has been paid: PENDING_PAYMENT →
// PLACED, kitchen tickets per station (routing was decided when the order was
// placed and stored on each item), and print jobs for printer branches.
import type { ActorType } from "@/generated/prisma/enums";
import type { Tx } from "../db";
import { recordBranchEvent } from "../events";

/**
 * Returns true if this call released the order; false if it was not waiting for
 * payment (already released, cancelled, …). Safe to call more than once.
 */
export async function releaseToKitchen(
  tx: Tx,
  order: { id: string; tenantId: string; branchId: string },
  actor: { type: ActorType; id: string | null },
  reason: string,
): Promise<boolean> {
  const now = new Date();
  const res = await tx.order.updateMany({
    where: { id: order.id, tenantId: order.tenantId, status: "PENDING_PAYMENT" },
    data: { status: "PLACED", releasedAt: now, paymentDueBy: null },
  });
  if (res.count !== 1) return false;

  await tx.orderStatusHistory.create({
    data: {
      tenantId: order.tenantId,
      orderId: order.id,
      fromStatus: "PENDING_PAYMENT",
      toStatus: "PLACED",
      actorType: actor.type,
      actorId: actor.id,
      reason,
    },
  });

  const [items, branch, stations] = await Promise.all([
    tx.orderItem.findMany({
      where: { orderId: order.id, tenantId: order.tenantId, kitchenTicketId: null },
      select: { id: true, stationId: true },
    }),
    tx.branch.findFirstOrThrow({
      where: { id: order.branchId, tenantId: order.tenantId },
      select: { fulfillmentMode: true },
    }),
    tx.kitchenStation.findMany({ where: { tenantId: order.tenantId, branchId: order.branchId, isActive: true } }),
  ]);
  const defaultStation = stations.find((s) => s.isDefault) ?? stations[0];
  const active = new Set(stations.map((s) => s.id));
  // A station switched off since the order was placed falls back to the default station.
  const stationOf = (id: string | null) => (id && active.has(id) ? id : (defaultStation?.id ?? id));

  const byStation = new Map<string, string[]>();
  for (const item of items) {
    const st = stationOf(item.stationId);
    if (!st) continue;
    byStation.set(st, [...(byStation.get(st) ?? []), item.id]);
  }

  const ticketIds = new Map<string, string>();
  for (const [stationId, itemIds] of byStation) {
    const ticket = await tx.kitchenTicket.upsert({
      where: { orderId_stationId: { orderId: order.id, stationId } },
      create: { tenantId: order.tenantId, branchId: order.branchId, orderId: order.id, stationId },
      update: {},
    });
    ticketIds.set(stationId, ticket.id);
    await tx.orderItem.updateMany({
      where: { id: { in: itemIds }, tenantId: order.tenantId },
      data: { kitchenTicketId: ticket.id, stationId },
    });
  }

  if (branch.fulfillmentMode === "PRINTER" || branch.fulfillmentMode === "DIGITAL_AND_PRINTER") {
    const printers = await tx.printerConfiguration.findMany({
      where: { tenantId: order.tenantId, branchId: order.branchId, isActive: true },
    });
    const jobs = [];
    for (const [stationId, ticketId] of ticketIds)
      for (const p of printers)
        if (!p.stationId || p.stationId === stationId)
          jobs.push({ tenantId: order.tenantId, branchId: order.branchId, ticketId, printerId: p.id });
    if (jobs.length) await tx.printJob.createMany({ data: jobs, skipDuplicates: true });
  }

  await recordBranchEvent(tx, {
    tenantId: order.tenantId,
    branchId: order.branchId,
    type: "order.created",
    entityId: order.id,
  });
  return true;
}
