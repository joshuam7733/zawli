import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { BranchTabs, pickBranch } from "@/components/branch-tabs";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { branchesWith } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { getPrintQueue } from "@/server/services/printing";
import { elapsed, FULFILLMENT_LABEL } from "@/lib/format";
import { markPrintJobAction } from "./actions";

export const metadata: Metadata = { title: "Print queue" };
export const dynamic = "force-dynamic";

export default async function PrintingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const allowed = branchesWith(ctx, "orders.view");
  if (allowed.length === 0) notFound();
  const branches = await db.branch.findMany({
    where: { tenantId: ctx.tenant.id, id: { in: allowed } },
    orderBy: { createdAt: "asc" },
  });
  const branch = pickBranch(branches, sp.branch)!;
  const jobs = await getPrintQueue(ctx, branch.id);
  const writable = ctx.tenant.status !== "SUSPENDED";

  return (
    <>
      <PageHeader
        title="Print queue"
        description={`Kitchen tickets waiting to be printed. ${branch.name} uses: ${FULFILLMENT_LABEL[branch.fulfillmentMode]}.`}
      />
      <BranchTabs branches={branches} current={branch.id} hrefFor={(id) => `/app/${slug}/printing?branch=${id}`} />
      <Card>
        {jobs.length === 0 ? (
          <EmptyState
            title="Nothing waiting to print"
            description={
              branch.fulfillmentMode === "DIGITAL_DISPLAY"
                ? "This branch uses the kitchen screen. Switch to a printer mode in Branches & kitchen to queue tickets."
                : "New tickets appear here when orders come in."
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Station</Th>
                <Th>Printer</Th>
                <Th>Waiting</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <Td>
                    <span className="font-mono font-semibold">#{j.ticket.order.reference}</span>
                    {j.ticket.order.tableLabel ? (
                      <span className="text-charcoal-500"> · T{j.ticket.order.tableLabel}</span>
                    ) : null}
                  </Td>
                  <Td>{j.ticket.station.name}</Td>
                  <Td>{j.printer.name}</Td>
                  <Td>{elapsed(j.createdAt)}</Td>
                  <Td>
                    {j.status === "FAILED" ? (
                      <Badge tone="danger" title={j.lastError ?? undefined}>
                        Failed ({j.attempts})
                      </Badge>
                    ) : (
                      <Badge tone="warning">Waiting{j.attempts ? ` · try ${j.attempts + 1}` : ""}</Badge>
                    )}
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      <Link
                        href={`/app/${slug}/print/ticket/${j.ticketId}?w=${j.printer.paperWidthMm}&auto=1`}
                        target="_blank"
                        className="text-forest-700 hover:bg-ivory-100 rounded-md px-2 py-1 text-sm font-medium"
                      >
                        Print
                      </Link>
                      {writable ? (
                        <>
                          <ActionButton
                            action={markPrintJobAction.bind(null, slug)}
                            fields={{ jobId: j.id, outcome: "PRINTED" }}
                            variant="ghost"
                          >
                            Mark printed
                          </ActionButton>
                          {j.status === "FAILED" ? (
                            <ActionButton
                              action={markPrintJobAction.bind(null, slug)}
                              fields={{ jobId: j.id, outcome: "RETRY" }}
                              variant="ghost"
                            >
                              Retry
                            </ActionButton>
                          ) : (
                            <ActionButton
                              action={markPrintJobAction.bind(null, slug)}
                              fields={{ jobId: j.id, outcome: "FAILED" }}
                              variant="ghost"
                            >
                              Failed
                            </ActionButton>
                          )}
                        </>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="text-charcoal-500 mt-4 max-w-2xl text-xs">
        Browsers can&apos;t print silently: each ticket opens the print dialog. For fully automatic thermal printing, a
        print-bridge helper on the kitchen computer is needed (see docs/ARCHITECTURE.md → Printing).
      </p>
    </>
  );
}
