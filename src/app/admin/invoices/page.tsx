import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { InvoiceBadge } from "@/components/status";
import { platformRoleHasPermission } from "@/domain/permissions";
import { requirePlatformPage } from "@/server/session";
import { listInvoices } from "@/server/services/billing";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const FILTERS = [
  ["all", "All"],
  ["open", "Open"],
  ["overdue", "Overdue"],
  ["draft", "Drafts"],
  ["paid", "Paid"],
] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePlatformPage("platform.tenants.view");
  if (!platformRoleHasPermission(user?.platformRole, "platform.billing.view")) notFound();
  const filter = (FILTERS.find(([k]) => k === sp.filter)?.[0] ?? "all") as (typeof FILTERS)[number][0];
  const invoices = await listInvoices(user, { filter });
  return (
    <>
      <PageHeader title="Invoices" description="Manual SaaS invoices. Create one from a restaurant's page." />
      <nav className="border-ivory-300 mb-4 inline-flex rounded-md border bg-white p-0.5">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={`/admin/invoices?filter=${k}`}
            aria-current={k === filter ? "page" : undefined}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium",
              k === filter ? "bg-forest-800 text-ivory-50" : "text-charcoal-600 hover:bg-ivory-100",
            )}
          >
            {label}
          </Link>
        ))}
      </nav>
      <Card>
        {invoices.length === 0 ? (
          <EmptyState title="No invoices" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Restaurant</Th>
                <Th>Due</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Paid</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <Td>
                    <Link href={`/admin/invoices/${i.id}`} className="text-forest-700 font-mono hover:underline">
                      {i.number}
                    </Link>
                  </Td>
                  <Td>{i.tenant.name}</Td>
                  <Td className="whitespace-nowrap">{formatDate(i.dueDate, "Africa/Kampala")}</Td>
                  <Td className="tabular text-right">{formatMoney(i.totalMinor, i.currency)}</Td>
                  <Td className="tabular text-right">{formatMoney(i.amountPaidMinor, i.currency)}</Td>
                  <Td>
                    <InvoiceBadge status={i.status} overdue={i.overdue} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
