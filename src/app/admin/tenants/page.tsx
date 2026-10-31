import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink, Card, EmptyState, Input, PageHeader, Select, Table, Td, Th, Button } from "@/components/ui";
import { DemoBadge, SubscriptionBadge, TenantStatusBadge } from "@/components/status";
import { platformRoleHasPermission } from "@/domain/permissions";
import { requirePlatformPage } from "@/server/session";
import { listTenants } from "@/server/services/platform-tenants";
import { formatDate } from "@/lib/format";
import type { SubscriptionStatus, TenantStatus } from "@/generated/prisma/enums";

export const metadata: Metadata = { title: "Restaurants" };
export const dynamic = "force-dynamic";

const TENANT_STATUSES = ["ONBOARDING", "ACTIVE", "SUSPENDED", "DEACTIVATED"];
const SUB_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"];

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; subscription?: string }>;
}) {
  const sp = await searchParams;
  const { user } = await requirePlatformPage("platform.tenants.view");
  const tenants = await listTenants(user, {
    q: sp.q || undefined,
    status: TENANT_STATUSES.includes(sp.status ?? "") ? (sp.status as TenantStatus) : undefined,
    subscription: SUB_STATUSES.includes(sp.subscription ?? "") ? (sp.subscription as SubscriptionStatus) : undefined,
  });
  return (
    <>
      <PageHeader
        title="Restaurants"
        description={`${tenants.length} shown`}
        actions={
          platformRoleHasPermission(user?.platformRole, "platform.tenants.manage") ? (
            <ButtonLink href="/admin/tenants/new">
              <Plus className="size-4" aria-hidden /> New restaurant
            </ButtonLink>
          ) : null
        }
      />
      <form className="mb-4 flex flex-wrap items-end gap-3" action="/admin/tenants">
        <div>
          <label htmlFor="q" className="sr-only">
            Search
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Name, slug or city" className="w-56" />
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={sp.status ?? ""} className="w-44">
            <option value="">Any status</option>
            {TENANT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="subscription" className="sr-only">
            Subscription
          </label>
          <Select id="subscription" name="subscription" defaultValue={sp.subscription ?? ""} className="w-44">
            <option value="">Any subscription</option>
            {SUB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase().replace("_", " ")}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>
      <Card>
        {tenants.length === 0 ? (
          <EmptyState title="No restaurants match" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Restaurant</Th>
                <Th>Status</Th>
                <Th>Plan</Th>
                <Th className="text-right">Branches</Th>
                <Th className="text-right">Staff</Th>
                <Th>Created</Th>
              </tr>
            </thead>
            <tbody>
              {tenants.map((t) => (
                <tr key={t.id} className="hover:bg-ivory-50">
                  <Td>
                    <Link href={`/admin/tenants/${t.id}`} className="text-forest-700 font-medium hover:underline">
                      {t.name}
                    </Link>
                    <span className="text-charcoal-500 block text-xs">
                      {t.slug}
                      {t.city ? ` · ${t.city}` : ""}
                    </span>
                  </Td>
                  <Td>
                    <span className="flex flex-wrap gap-1">
                      <TenantStatusBadge status={t.status} />
                      {t.isDemo ? <DemoBadge /> : null}
                    </span>
                  </Td>
                  <Td>
                    {t.subscription ? (
                      <span className="flex flex-wrap items-center gap-1.5">
                        {t.subscription.plan.name} <SubscriptionBadge status={t.subscription.status} />
                      </span>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td className="tabular text-right">{t._count.branches}</Td>
                  <Td className="tabular text-right">{t._count.memberships}</Td>
                  <Td className="text-charcoal-600 whitespace-nowrap">{formatDate(t.createdAt, t.timezone)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
