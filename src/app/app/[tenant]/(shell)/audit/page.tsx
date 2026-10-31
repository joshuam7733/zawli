import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Card, EmptyState, PageHeader, Table, Td, Th } from "@/components/ui";
import { can } from "@/server/authz";
import { requireTenantPage } from "@/server/session";
import { getTenantAudit } from "@/server/services/reports";
import { describeAction, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Activity log" };

export default async function AuditPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "tenant.audit.view")) notFound();
  const entries = await getTenantAudit(ctx, 300);
  return (
    <>
      <PageHeader
        title="Activity log"
        description="Sensitive changes in your restaurant: prices, staff, payments voided, settings and account status."
      />
      <Card>
        {entries.length === 0 ? (
          <EmptyState title="No activity yet" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Who</Th>
                <Th>What</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="text-charcoal-600 whitespace-nowrap">
                    {formatDateTime(e.createdAt, ctx.tenant.timezone, ctx.tenant.locale)}
                  </Td>
                  <Td>{e.actor ? (e.actor.platformRole ? `${e.actor.name} (platform)` : e.actor.name) : "System"}</Td>
                  <Td className="font-medium">{describeAction(e.action)}</Td>
                  <Td
                    className="text-charcoal-500 max-w-md truncate font-mono text-xs"
                    title={e.metadata ? JSON.stringify(e.metadata) : undefined}
                  >
                    {e.metadata ? JSON.stringify(e.metadata) : ""}
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
