import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardHeader, EmptyState, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { InvoiceBadge, SubscriptionBadge } from "@/components/status";
import { can } from "@/server/authz";
import { requireTenantPage } from "@/server/session";
import { getTenantBilling } from "@/server/services/billing";
import { formatDate, formatMoney } from "@/lib/format";

export const metadata: Metadata = { title: "Subscription & invoices" };

export default async function BillingPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "tenant.billing.view")) notFound();
  const { subscription, invoices } = await getTenantBilling(ctx);
  const tz = ctx.tenant.timezone;
  const loc = ctx.tenant.locale;
  const overdue = invoices.filter((i) => i.overdue);

  return (
    <>
      <PageHeader
        title="Subscription & invoices"
        description="Your plan with us. Invoices are issued by the platform team; pay by the method on the invoice."
      />
      {overdue.length ? (
        <Notice
          tone="warning"
          className="mb-6 max-w-4xl"
          title={`${overdue.length} invoice${overdue.length === 1 ? " is" : "s are"} overdue`}
        >
          Please settle to avoid interruption. Already paid? Send your payment reference to the platform team.
        </Notice>
      ) : null}
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader title="Your plan" />
          {subscription ? (
            <dl className="grid gap-4 px-5 py-5 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-charcoal-500">Plan</dt>
                <dd className="mt-1 font-semibold">{subscription.plan.name}</dd>
              </div>
              <div>
                <dt className="text-charcoal-500">Status</dt>
                <dd className="mt-1">
                  <SubscriptionBadge status={subscription.status} />
                </dd>
              </div>
              <div>
                <dt className="text-charcoal-500">Price</dt>
                <dd className="tabular mt-1 font-semibold">
                  {formatMoney(subscription.plan.priceMinor, subscription.plan.currency, loc)} /{" "}
                  {subscription.plan.billingInterval === "MONTHLY" ? "month" : "year"}
                </dd>
              </div>
              <div>
                <dt className="text-charcoal-500">
                  {subscription.status === "TRIAL" ? "Trial ends" : "Current period ends"}
                </dt>
                <dd className="mt-1">
                  {subscription.status === "TRIAL" && subscription.trialEndsAt
                    ? formatDate(subscription.trialEndsAt, tz, loc)
                    : subscription.currentPeriodEnd
                      ? formatDate(subscription.currentPeriodEnd, tz, loc)
                      : "—"}
                </dd>
              </div>
            </dl>
          ) : (
            <EmptyState title="No subscription on file" />
          )}
        </Card>
        <Card>
          <CardHeader title="Invoices" />
          {invoices.length === 0 ? (
            <EmptyState title="No invoices yet" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Number</Th>
                  <Th>Period</Th>
                  <Th>Due</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <Td>
                      <Link
                        href={`/app/${slug}/print/invoice/${i.id}`}
                        target="_blank"
                        className="text-forest-700 font-mono font-medium hover:underline"
                      >
                        {i.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap">
                      {formatDate(i.periodStart, tz, loc)} – {formatDate(i.periodEnd, tz, loc)}
                    </Td>
                    <Td className="whitespace-nowrap">{formatDate(i.dueDate, tz, loc)}</Td>
                    <Td className="tabular text-right">
                      {formatMoney(i.totalMinor, i.currency, loc)}
                      {i.amountPaidMinor > 0 && i.amountPaidMinor < i.totalMinor ? (
                        <span className="text-charcoal-500 block text-xs">
                          paid {formatMoney(i.amountPaidMinor, i.currency, loc)}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <InvoiceBadge status={i.status} overdue={i.overdue} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
