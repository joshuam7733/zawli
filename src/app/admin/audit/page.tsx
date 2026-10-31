import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Button, Card, EmptyState, Input, PageHeader, Table, Td, Th } from "@/components/ui";
import { platformRoleHasPermission } from "@/domain/permissions";
import { requirePlatformPage } from "@/server/session";
import { getPlatformAudit } from "@/server/services/reports";
import { describeAction, formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ action?: string }> }) {
  const sp = await searchParams;
  const { user } = await requirePlatformPage("platform.tenants.view");
  if (!platformRoleHasPermission(user?.platformRole, "platform.audit.view")) notFound();
  const entries = await getPlatformAudit(user, { action: sp.action?.trim() || null });
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Sensitive actions across the platform (latest 300). Passwords and tokens are never logged."
      />
      <form className="mb-4 flex gap-2" action="/admin/audit">
        <label htmlFor="action" className="sr-only">
          Filter by action
        </label>
        <Input
          id="action"
          name="action"
          defaultValue={sp.action ?? ""}
          placeholder="Action starts with, e.g. tenant. or payment."
          className="w-72"
        />
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card>
        {entries.length === 0 ? (
          <EmptyState title="No matching entries" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When (Kampala)</Th>
                <Th>Restaurant</Th>
                <Th>Who</Th>
                <Th>Action</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <Td className="text-charcoal-600 whitespace-nowrap">
                    {formatDateTime(e.createdAt, "Africa/Kampala")}
                  </Td>
                  <Td>{e.tenant?.name ?? "Platform"}</Td>
                  <Td>{e.actor?.name ?? "System"}</Td>
                  <Td className="font-medium">{describeAction(e.action)}</Td>
                  <Td
                    className="text-charcoal-500 max-w-sm truncate font-mono text-xs"
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
