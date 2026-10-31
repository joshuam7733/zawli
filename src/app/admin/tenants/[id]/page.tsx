import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Circle, FilePlus2 } from "lucide-react";
import { ActionForm, RevealButton } from "@/components/action-form";
import { Badge, ButtonLink, Card, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from "@/components/ui";
import { DemoBadge, InvoiceBadge, SubscriptionBadge, TenantStatusBadge } from "@/components/status";
import { allowedSubscriptionTransitions, isInvoiceOverdue } from "@/domain/billing";
import { platformRoleHasPermission, ROLE_LABELS } from "@/domain/permissions";
import { db } from "@/server/db";
import { requirePlatformPage } from "@/server/session";
import { getTenantReadiness } from "@/server/services/platform-tenants";
import { formatDate, formatDateTime, formatMoney, FULFILLMENT_LABEL } from "@/lib/format";
import {
  changeSubscriptionAction,
  reissueOwnerLinkAction,
  setTenantStatusAction,
  updateTenantAction,
} from "../../actions";

export const metadata: Metadata = { title: "Restaurant" };
export const dynamic = "force-dynamic";

const NEXT_STATUS: Record<string, { to: string; label: string; danger?: boolean }[]> = {
  ONBOARDING: [
    { to: "ACTIVE", label: "Go live" },
    { to: "DEACTIVATED", label: "Deactivate", danger: true },
  ],
  ACTIVE: [
    { to: "SUSPENDED", label: "Suspend", danger: true },
    { to: "DEACTIVATED", label: "Deactivate", danger: true },
  ],
  SUSPENDED: [
    { to: "ACTIVE", label: "Reactivate" },
    { to: "DEACTIVATED", label: "Deactivate", danger: true },
  ],
  DEACTIVATED: [{ to: "SUSPENDED", label: "Restore (read-only)" }],
};

/**
 * Platform view of one tenant. Access to tenant information here is an explicit
 * platform permission (platform.tenants.view) — it shows configuration and
 * billing, not customers' order details.
 */
export default async function AdminTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requirePlatformPage("platform.tenants.view");
  const tenant = await db.tenant.findUnique({
    where: { id },
    include: {
      branches: { orderBy: { createdAt: "asc" }, include: { _count: { select: { tables: true } } } },
      memberships: {
        where: { role: "RESTAURANT_OWNER" },
        include: {
          user: { include: { accounts: { where: { providerId: "credential" }, select: { password: true } } } },
        },
      },
      subscription: { include: { plan: true, events: { orderBy: { createdAt: "desc" }, take: 8 } } },
      invoices: { orderBy: { createdAt: "desc" }, take: 20 },
      _count: { select: { memberships: true, menuItems: true, orders: true } },
    },
  });
  if (!tenant) notFound();
  const [readiness, plans] = await Promise.all([
    getTenantReadiness(tenant.id),
    db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { priceMinor: "asc" } }),
  ]);
  const canManage = platformRoleHasPermission(user?.platformRole, "platform.tenants.manage");
  const canBill = platformRoleHasPermission(user?.platformRole, "platform.billing.manage");
  const sub = tenant.subscription;
  const tz = tenant.timezone;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/tenants" className="text-forest-700 hover:underline">
          ← Restaurants
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {tenant.name} <TenantStatusBadge status={tenant.status} /> {tenant.isDemo ? <DemoBadge /> : null}
          </span>
        }
        description={`${tenant.slug} · ${tenant.city ?? "—"} · ${tenant.currency} · ${tenant.timezone} · ${tenant._count.memberships} staff · ${tenant._count.menuItems} menu items · ${tenant._count.orders} orders`}
        actions={
          canBill ? (
            <ButtonLink href={`/admin/invoices/new?tenant=${tenant.id}`} variant="secondary">
              <FilePlus2 className="size-4" aria-hidden /> New invoice
            </ButtonLink>
          ) : null
        }
      />
      {tenant.suspensionReason && tenant.status !== "ACTIVE" ? (
        <p className="text-warning-700 mb-4 text-sm">Reason: {tenant.suspensionReason}</p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Go-live checklist" />
          <ul className="grid gap-2 px-5 py-4 text-sm">
            {readiness.map((r) => (
              <li key={r.key} className="flex items-center gap-2">
                {r.done ? (
                  <CheckCircle2 className="text-forest-600 size-4" aria-hidden />
                ) : (
                  <Circle className="text-charcoal-300 size-4" aria-hidden />
                )}
                {r.label}
              </li>
            ))}
          </ul>
          {canManage ? (
            <div className="border-ivory-200 border-t px-5 py-4">
              <ActionForm action={setTenantStatusAction} submitLabel="Change status" submitVariant="secondary">
                <input type="hidden" name="tenantId" value={tenant.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="New status" htmlFor="status">
                    <Select id="status" name="status">
                      {NEXT_STATUS[tenant.status].map((n) => (
                        <option key={n.to} value={n.to}>
                          {n.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Reason"
                    htmlFor="reason"
                    hint="Required to suspend or deactivate. Data is never deleted."
                  >
                    <Input id="reason" name="reason" maxLength={300} />
                  </Field>
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Subscription" />
          {sub ? (
            <>
              <dl className="grid grid-cols-2 gap-3 px-5 py-4 text-sm">
                <dt className="text-charcoal-500">Plan</dt>
                <dd className="font-medium">
                  {sub.plan.name} · {formatMoney(sub.plan.priceMinor, sub.plan.currency)}/
                  {sub.plan.billingInterval === "MONTHLY" ? "mo" : "yr"}
                </dd>
                <dt className="text-charcoal-500">Status</dt>
                <dd>
                  <SubscriptionBadge status={sub.status} />
                </dd>
                {sub.trialEndsAt ? (
                  <>
                    <dt className="text-charcoal-500">Trial ends</dt>
                    <dd>{formatDate(sub.trialEndsAt, tz)}</dd>
                  </>
                ) : null}
                <dt className="text-charcoal-500">Period ends</dt>
                <dd>{sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd, tz) : "—"}</dd>
              </dl>
              {canBill ? (
                <div className="border-ivory-200 border-t px-5 py-4">
                  <ActionForm
                    action={changeSubscriptionAction}
                    submitLabel="Update subscription"
                    submitVariant="secondary"
                  >
                    <input type="hidden" name="tenantId" value={tenant.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Status" htmlFor="sub-status">
                        <Select id="sub-status" name="status" defaultValue="">
                          <option value="">Keep {sub.status.toLowerCase().replace("_", " ")}</option>
                          {allowedSubscriptionTransitions(sub.status).map((s) => (
                            <option key={s} value={s}>
                              {s.toLowerCase().replace("_", " ")}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Plan" htmlFor="sub-plan">
                        <Select id="sub-plan" name="planId" defaultValue={sub.planId}>
                          {plans.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Period ends" htmlFor="sub-end">
                        <Input
                          id="sub-end"
                          name="currentPeriodEnd"
                          type="date"
                          defaultValue={sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? ""}
                        />
                      </Field>
                      <Field label="Reason" htmlFor="sub-reason" hint="Kept in the subscription history">
                        <Input id="sub-reason" name="reason" required minLength={3} maxLength={300} />
                      </Field>
                    </div>
                    <p className="text-charcoal-500 text-xs">
                      Suspended or cancelled subscriptions make the restaurant read-only and stop QR ordering. Returning
                      to active restores it.
                    </p>
                  </ActionForm>
                </div>
              ) : null}
              {sub.events.length ? (
                <ul className="border-ivory-200 text-charcoal-600 border-t px-5 py-3 text-xs">
                  {sub.events.map((e) => (
                    <li key={e.id}>
                      {formatDateTime(e.createdAt, tz)} · {e.fromStatus ? `${e.fromStatus.toLowerCase()} → ` : ""}
                      {e.toStatus.toLowerCase()} {e.reason ? `· ${e.reason}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="text-charcoal-500 px-5 py-4 text-sm">No subscription.</p>
          )}
        </Card>

        <Card>
          <CardHeader title="Owner accounts" />
          <ul className="divide-ivory-200 divide-y text-sm">
            {tenant.memberships.map((m) => {
              const hasPassword = m.user.accounts.some((a) => !!a.password);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="font-medium">{m.user.name}</span>
                  <span className="text-charcoal-500">{m.user.email}</span>
                  <Badge>{ROLE_LABELS[m.role]}</Badge>
                  {!hasPassword ? <Badge tone="warning">Setup pending</Badge> : null}
                  {m.user.lastLoginAt ? (
                    <span className="text-charcoal-500 text-xs">last login {formatDate(m.user.lastLoginAt, tz)}</span>
                  ) : null}
                  {canManage ? (
                    <span className="ml-auto">
                      <RevealButton
                        action={reissueOwnerLinkAction}
                        fields={{ tenantId: tenant.id, userId: m.userId }}
                        label={hasPassword ? "Reset password link" : "New setup link"}
                        revealLabel="One-time link for the owner"
                        note="Send privately. Older links stop working."
                        confirm={
                          hasPassword
                            ? "Issue a password reset link? The owner keeps their current password until they use it."
                            : undefined
                        }
                      />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Branches" />
          <ul className="divide-ivory-200 divide-y text-sm">
            {tenant.branches.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5">
                <span className="font-medium">{b.name}</span>
                <Badge>{FULFILLMENT_LABEL[b.fulfillmentMode]}</Badge>
                {!b.isActive ? <Badge tone="danger">Inactive</Badge> : null}
                <span className="text-charcoal-500 ml-auto">{b._count.tables} tables</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Invoices" />
          {tenant.invoices.length === 0 ? (
            <p className="text-charcoal-500 px-5 py-4 text-sm">No invoices yet.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Total</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {tenant.invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link href={`/admin/invoices/${i.id}`} className="text-forest-700 font-mono hover:underline">
                        {i.number}
                      </Link>
                    </Td>
                    <Td>{formatDate(i.dueDate, tz)}</Td>
                    <Td className="tabular text-right">{formatMoney(i.totalMinor, i.currency)}</Td>
                    <Td>
                      <InvoiceBadge status={i.status} overdue={isInvoiceOverdue(i)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {canManage ? (
          <Card className="xl:col-span-2">
            <details>
              <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">Edit restaurant profile</summary>
              <div className="border-ivory-200 border-t px-5 py-5">
                <ActionForm action={updateTenantAction} submitLabel="Save profile">
                  <input type="hidden" name="tenantId" value={tenant.id} />
                  <div className="grid gap-4 sm:grid-cols-3">
                    {(
                      [
                        ["name", "Name", tenant.name],
                        ["legalName", "Registered name", tenant.legalName],
                        ["contactEmail", "Contact email", tenant.contactEmail],
                        ["contactPhone", "Phone", tenant.contactPhone],
                        ["addressLine", "Address", tenant.addressLine],
                        ["city", "City", tenant.city],
                        ["country", "Country", tenant.country],
                        ["currency", "Currency", tenant.currency],
                        ["timezone", "Timezone", tenant.timezone],
                        ["locale", "Locale", tenant.locale],
                        ["brandPrimary", "Brand colour", tenant.brandPrimary],
                        ["brandAccent", "Accent colour", tenant.brandAccent],
                      ] as const
                    ).map(([name, label, value]) => (
                      <Field key={name} label={label} htmlFor={`t-${name}`}>
                        <Input id={`t-${name}`} name={name} defaultValue={value ?? ""} />
                      </Field>
                    ))}
                  </div>
                </ActionForm>
              </div>
            </details>
          </Card>
        ) : null}
      </div>
    </>
  );
}
