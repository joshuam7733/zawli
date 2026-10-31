// Kitchen printing. Print jobs are rows (one per ticket × printer, unique), so
// retries and reconnects never duplicate tickets or orders.
//
// Transports (docs/ARCHITECTURE.md → Printing):
//  * BROWSER      — staff open the print queue and print with the browser dialog
//                   (works everywhere, not silent). Staff confirm "printed".
//  * PRINT_BRIDGE — a small local helper on the restaurant network polls
//                   /api/print-bridge with its API key, prints ESC/POS, and acks.
//                   The helper is NOT part of V1; the API contract is.
import { z } from "zod";
import { PrinterConnection } from "@/generated/prisma/enums";
import { formatTicketText, type TicketForPrint } from "@/domain/ticket-format";
import { db } from "../db";
import { requirePermission, requireWritable, type TenantContext } from "../authz";
import { AppError, notFound, validation } from "../errors";
import { writeAudit } from "../audit";
import { randomToken, sha256 } from "../tokens";
import { idSchema } from "../validation";

export const MAX_PRINT_ATTEMPTS = 5;

export async function listPrinters(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "orders.view", branchId);
  return db.printerConfiguration.findMany({
    where: { tenantId: ctx.tenant.id, branchId },
    orderBy: { createdAt: "asc" },
    include: { station: { select: { name: true } } },
  });
}

export const printerSchema = z.object({
  branchId: idSchema,
  name: z.string().trim().min(2).max(40),
  stationId: idSchema
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  connection: z.enum(PrinterConnection),
  paperWidthMm: z.coerce.number().refine((v) => v === 58 || v === 80 || v === 210, "Choose 58 mm, 80 mm or A4."),
  copies: z.coerce.number().int().min(1).max(5).default(1),
});

export async function createPrinter(ctx: TenantContext, input: z.input<typeof printerSchema>) {
  const data = printerSchema.parse(input);
  requirePermission(ctx, "printing.manage", data.branchId);
  requireWritable(ctx);
  const branch = await db.branch.findFirst({ where: { id: data.branchId, tenantId: ctx.tenant.id } });
  if (!branch) throw notFound("Branch");
  if (data.stationId) {
    const st = await db.kitchenStation.findFirst({
      where: { id: data.stationId, tenantId: ctx.tenant.id, branchId: branch.id },
    });
    if (!st) throw notFound("Station");
  }
  const bridgeKey = data.connection === "PRINT_BRIDGE" ? `zpb_${randomToken(24)}` : null;
  const printer = await db.$transaction(async (tx) => {
    const p = await tx.printerConfiguration.create({
      data: {
        tenantId: ctx.tenant.id,
        branchId: branch.id,
        stationId: data.stationId ?? null,
        name: data.name,
        connection: data.connection,
        paperWidthMm: data.paperWidthMm,
        copies: data.copies,
        bridgeTokenHash: bridgeKey ? sha256(bridgeKey) : null,
      },
    });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "printer.created",
      entityType: "PrinterConfiguration",
      entityId: p.id,
      metadata: { name: p.name, connection: p.connection },
    });
    return p;
  });
  // The bridge key is shown ONCE; only its hash is stored.
  return { printer, bridgeKey };
}

export async function setPrinterActive(ctx: TenantContext, input: { printerId: string; active: boolean }) {
  const p = await db.printerConfiguration.findFirst({
    where: { id: idSchema.parse(input.printerId), tenantId: ctx.tenant.id },
  });
  if (!p) throw notFound("Printer");
  requirePermission(ctx, "printing.manage", p.branchId);
  requireWritable(ctx);
  await db.printerConfiguration.update({ where: { id: p.id }, data: { isActive: input.active } });
}

export async function rotateBridgeKey(ctx: TenantContext, input: { printerId: string }) {
  const p = await db.printerConfiguration.findFirst({
    where: { id: idSchema.parse(input.printerId), tenantId: ctx.tenant.id },
  });
  if (!p) throw notFound("Printer");
  requirePermission(ctx, "printing.manage", p.branchId);
  requireWritable(ctx);
  if (p.connection !== "PRINT_BRIDGE") throw validation("Only print-bridge printers have API keys.");
  const bridgeKey = `zpb_${randomToken(24)}`;
  await db.$transaction(async (tx) => {
    await tx.printerConfiguration.update({ where: { id: p.id }, data: { bridgeTokenHash: sha256(bridgeKey) } });
    await writeAudit(tx, {
      tenantId: ctx.tenant.id,
      actorId: ctx.user.id,
      action: "printer.key_rotated",
      entityType: "PrinterConfiguration",
      entityId: p.id,
    });
  });
  return bridgeKey;
}

async function ticketPrintData(tenantId: string, ticketId: string): Promise<TicketForPrint & { branchId: string }> {
  const t = await db.kitchenTicket.findFirst({
    where: { id: ticketId, tenantId },
    include: {
      station: true,
      branch: true,
      tenant: { select: { name: true, timezone: true, locale: true } },
      order: true,
      items: { orderBy: { sortOrder: "asc" }, include: { modifiers: true } },
    },
  });
  if (!t) throw notFound("Ticket");
  const tz = t.branch.timezone ?? t.tenant.timezone;
  return {
    branchId: t.branchId,
    reference: t.order.reference,
    tableLabel: t.order.tableLabel,
    stationName: t.station.name,
    branchName: t.branch.name,
    restaurantName: t.tenant.name,
    placedAt: new Intl.DateTimeFormat(t.tenant.locale, {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(t.order.placedAt),
    customerName: t.order.customerName,
    customerNote: t.order.customerNote,
    items: t.items.map((i) => ({
      quantity: i.quantity,
      name: i.nameSnapshot,
      variant: i.variantNameSnapshot,
      modifiers: i.modifiers.map((m) => m.nameSnapshot),
      note: i.note,
      allergens: i.allergensSnapshot,
    })),
  };
}

export async function getTicketForPrint(ctx: TenantContext, ticketId: string) {
  const data = await ticketPrintData(ctx.tenant.id, idSchema.parse(ticketId));
  requirePermission(ctx, "orders.view", data.branchId);
  return data;
}

export async function getPrintQueue(ctx: TenantContext, branchId: string) {
  requirePermission(ctx, "orders.view", idSchema.parse(branchId));
  return db.printJob.findMany({
    where: { tenantId: ctx.tenant.id, branchId, status: { in: ["PENDING", "FAILED"] } },
    orderBy: { createdAt: "asc" },
    take: 100,
    include: {
      printer: { select: { name: true, connection: true, paperWidthMm: true } },
      ticket: {
        include: { order: { select: { reference: true, tableLabel: true } }, station: { select: { name: true } } },
      },
    },
  });
}

export const markJobSchema = z.object({
  jobId: idSchema,
  outcome: z.enum(["PRINTED", "FAILED", "RETRY"]),
  error: z.string().max(300).optional().nullable(),
});

/** Staff confirm a browser print, report a failure, or queue a retry. */
export async function markPrintJob(ctx: TenantContext, input: z.input<typeof markJobSchema>) {
  const data = markJobSchema.parse(input);
  const job = await db.printJob.findFirst({ where: { id: data.jobId, tenantId: ctx.tenant.id } });
  if (!job) throw notFound("Print job");
  requirePermission(ctx, "orders.view", job.branchId);
  requireWritable(ctx);
  if (data.outcome === "PRINTED") {
    await db.printJob.update({
      where: { id: job.id },
      data: { status: "PRINTED", printedAt: new Date(), attempts: { increment: 1 } },
    });
  } else if (data.outcome === "FAILED") {
    await db.printJob.update({
      where: { id: job.id },
      data: { status: "FAILED", lastError: data.error ?? "Marked failed by staff", attempts: { increment: 1 } },
    });
  } else {
    // Re-queue the same job (never a second job for the same ticket & printer).
    await db.printJob.update({ where: { id: job.id }, data: { status: "PENDING", lastError: null } });
  }
}

/** Queues a reprint of a ticket on every active printer that covers its station. */
export async function requestReprint(ctx: TenantContext, input: { ticketId: string }) {
  const ticket = await db.kitchenTicket.findFirst({
    where: { id: idSchema.parse(input.ticketId), tenantId: ctx.tenant.id },
  });
  if (!ticket) throw notFound("Ticket");
  requirePermission(ctx, "orders.view", ticket.branchId);
  requireWritable(ctx);
  const printers = await db.printerConfiguration.findMany({
    where: {
      tenantId: ctx.tenant.id,
      branchId: ticket.branchId,
      isActive: true,
      OR: [{ stationId: null }, { stationId: ticket.stationId }],
    },
  });
  for (const p of printers) {
    await db.printJob.upsert({
      where: { ticketId_printerId: { ticketId: ticket.id, printerId: p.id } },
      create: { tenantId: ctx.tenant.id, branchId: ticket.branchId, ticketId: ticket.id, printerId: p.id },
      update: { status: "PENDING", lastError: null },
    });
  }
  return printers.length;
}

// ───────────── Print bridge API (machine-to-machine) ─────────────

async function printerForKey(apiKey: string | null) {
  if (!apiKey || !/^zpb_[A-Za-z0-9_-]{20,64}$/.test(apiKey))
    throw new AppError("UNAUTHENTICATED", "Invalid print bridge key.");
  const p = await db.printerConfiguration.findUnique({
    where: { bridgeTokenHash: sha256(apiKey) },
    include: { tenant: { select: { status: true } }, branch: { select: { isActive: true } } },
  });
  if (!p || !p.isActive || p.connection !== "PRINT_BRIDGE" || !p.branch.isActive)
    throw new AppError("UNAUTHENTICATED", "Invalid print bridge key.");
  if (p.tenant.status === "SUSPENDED" || p.tenant.status === "DEACTIVATED")
    throw new AppError("TENANT_SUSPENDED", "Restaurant account suspended.");
  return p;
}

/** Pending jobs for the bridge's printer, rendered as plain text for its paper width. */
export async function bridgeFetchJobs(apiKey: string | null) {
  const printer = await printerForKey(apiKey);
  const jobs = await db.printJob.findMany({
    where: {
      printerId: printer.id,
      tenantId: printer.tenantId,
      status: "PENDING",
      attempts: { lt: MAX_PRINT_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const out = [];
  for (const job of jobs) {
    const data = await ticketPrintData(printer.tenantId, job.ticketId);
    out.push({
      jobId: job.id,
      copies: printer.copies,
      paperWidthMm: printer.paperWidthMm,
      text: formatTicketText({ ...data, reprint: job.attempts > 0 }, printer.paperWidthMm),
    });
  }
  return out;
}

export const bridgeAckSchema = z.object({
  jobId: idSchema,
  ok: z.boolean(),
  error: z.string().max(300).optional().nullable(),
});

export async function bridgeAck(apiKey: string | null, input: z.input<typeof bridgeAckSchema>) {
  const printer = await printerForKey(apiKey);
  const data = bridgeAckSchema.parse(input);
  const job = await db.printJob.findFirst({
    where: { id: data.jobId, printerId: printer.id, tenantId: printer.tenantId },
  });
  if (!job) throw notFound("Print job");
  if (job.status === "PRINTED") return { status: job.status };
  const attempts = job.attempts + 1;
  const status = data.ok ? "PRINTED" : attempts >= MAX_PRINT_ATTEMPTS ? "FAILED" : "PENDING";
  await db.printJob.update({
    where: { id: job.id },
    data: {
      status,
      attempts,
      printedAt: data.ok ? new Date() : null,
      lastError: data.ok ? null : (data.error ?? "Printer error"),
    },
  });
  return { status };
}
