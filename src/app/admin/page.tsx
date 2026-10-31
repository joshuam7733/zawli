import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { ActionButton } from "@/components/action-form";
import { ButtonLink, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { platformRoleHasPermission } from "@/domain/permissions";
import { requirePlatformPage } from "@/server/session";
import { getPlatformOverview } from "@/server/services/platform-tenants";
import { getPlatformAudit } from "@/server/services/reports";
import { describeAction, formatDateTime } from "@/lib/format";
import { billingSweepAction } from "./actions";

export const metadata: Metadata = { title: "Platform overview" };
export const dynamic = "force-dynamic";

export default async function AdminOverview() {
  const { user } = await requirePlatformPage("platform.tenants.view");
  const o = await getPlatformOverview(user);
  const canManage = platformRoleHasPermission(user?.platformRole, "platform.tenants.manage");
  const canBill = platformRoleHasPermission(user?.platformRole, "platform.billing.manage");
  const audit = platformRoleHasPermission(user?.platformRole, "platform.audit.view")
    ? (await getPlatformAudit(user)).slice(0, 12)
    : [];
  const t = o.tenantsByStatus;
  const sub = o.subscriptionsByStatus;

  return (
    <>
      <PageHeader
        title="Platform overview"
        description="Restaurants on the platform and billing health."
        actions={
          <>
            {canBill ? (
              <ActionButton action={billingSweepAction} variant="secondary" size="md">
                Run billing check
              </ActionButton>
            ) : null}
            {canManage ? (
              <ButtonLink href="/admin/tenants/new">
                <Plus className="size-4" aria-hidden /> New restaurant
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Live restaurants" value={t.ACTIVE ?? 0} hint={`${t.ONBOARDING ?? 0} onboarding`} />
        <Stat
          label="Suspended"
          value={t.SUSPENDED ?? 0}
          hint={`${t.DEACTIVATED ?? 0} deactivated`}
          tone={(t.SUSPENDED ?? 0) > 0 ? "alert" : "default"}
        />
        <Stat label="Orders (24 h)" value={o.orders24h} hint="All restaurants" />
        <Stat
          label="Overdue invoices"
          value={o.overdueInvoices}
          hint={`${o.openInvoices} open`}
          tone={o.overdueInvoices > 0 ? "alert" : "default"}
        />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Subscriptions" />
          <ul className="divide-ivory-200 divide-y text-sm">
            {(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "CANCELLED"] as const).map((k) => (
              <li key={k} className="flex justify-between px-5 py-2.5">
                <Link href={`/admin/tenants?subscription=${k}`} className="hover:underline">
                  {k
                    .replace("_", " ")
                    .toLowerCase()
                    .replace(/^\w/, (c) => c.toUpperCase())}
                </Link>
                <span className="tabular font-semibold">{sub[k] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader
            title="Recent platform activity"
            action={
              audit.length ? (
                <ButtonLink href="/admin/audit" variant="ghost" size="sm">
                  All
                </ButtonLink>
              ) : null
            }
          />
          {audit.length === 0 ? (
            <p className="text-charcoal-500 px-5 py-4 text-sm">No activity.</p>
          ) : (
            <ul className="divide-ivory-200 divide-y text-sm">
              {audit.map((a) => (
                <li key={a.id} className="px-5 py-2.5">
                  <p className="font-medium">
                    {describeAction(a.action)}
                    {a.tenant ? <span className="text-charcoal-500 font-normal"> · {a.tenant.name}</span> : null}
                  </p>
                  <p className="text-charcoal-500 text-xs">
                    {formatDateTime(a.createdAt, "Africa/Kampala")} · {a.actor?.name ?? "System"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <p className="text-charcoal-500 mt-6 text-xs">
        The billing check moves subscriptions with overdue invoices or expired trials to “past due”. It never suspends a
        restaurant automatically.
      </p>
    </>
  );
}
