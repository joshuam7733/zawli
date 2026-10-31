import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle } from "lucide-react";
import { Card, CardHeader, EmptyState, PageHeader, Stat, Table, Td, Th, ButtonLink } from "@/components/ui";
import { OrderStatusBadge } from "@/components/status";
import { DailyBars } from "@/components/charts";
import { can, roleAt } from "@/server/authz";
import { requireTenantPage } from "@/server/session";
import { getDashboard } from "@/server/services/reports";
import { getTenantReadiness } from "@/server/services/platform-tenants";
import { formatMoney, formatTime, PAYMENT_METHOD_LABEL, ORDER_STATUS_LABEL } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Dashboard" };

const RANGES = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
] as const;

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ range?: string; branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const base = `/app/${slug}`;
  if (!can(ctx, "reports.view")) {
    const roles = [...ctx.branchRoles.keys()].map((b) => roleAt(ctx, b));
    redirect(roles.includes("KITCHEN") && !roles.includes("WAITER") ? `${base}/kitchen` : `${base}/floor`);
  }
  const range = (RANGES.find((r) => r.key === sp.range)?.key ?? "today") as "today" | "7d" | "30d";
  const branchId = sp.branch && ctx.branchRoles.has(sp.branch) ? sp.branch : null;
  const [d, readiness] = await Promise.all([
    getDashboard(ctx, { range, branchId }),
    ctx.tenant.status === "ONBOARDING" ? getTenantReadiness(ctx.tenant.id) : Promise.resolve(null),
  ]);
  const money = (m: number) => formatMoney(m, d.currency, ctx.tenant.locale);
  const tz = ctx.tenant.timezone;
  const rangeLabel = RANGES.find((r) => r.key === range)!.label.toLowerCase();

  return (
    <>
      <PageHeader
        eyebrow={ctx.tenant.name}
        title="Dashboard"
        description={
          ctx.tenant.isDemo
            ? "Figures below come from fictional demo orders."
            : "Live figures from your orders and recorded payments."
        }
        actions={
          <div
            role="tablist"
            aria-label="Date range"
            className="border-ivory-300 inline-flex rounded-md border bg-white p-0.5"
          >
            {RANGES.map((r) => (
              <Link
                key={r.key}
                role="tab"
                aria-selected={r.key === range}
                href={`${base}?range=${r.key}${branchId ? `&branch=${branchId}` : ""}`}
                className={cn(
                  "rounded px-3 py-1.5 text-sm font-medium",
                  r.key === range ? "bg-forest-800 text-ivory-50" : "text-charcoal-600 hover:bg-ivory-100",
                )}
              >
                {r.label}
              </Link>
            ))}
          </div>
        }
      />

      {readiness ? (
        <Card className="mb-6">
          <CardHeader
            title="Go-live checklist"
            description="The platform team switches your restaurant live once everything is ticked."
          />
          <ul className="grid gap-x-6 gap-y-2 px-5 py-4 sm:grid-cols-2">
            {readiness.map((r) => (
              <li key={r.key} className="flex items-center gap-2 text-sm">
                {r.done ? (
                  <CheckCircle2 className="text-forest-600 size-4" aria-hidden />
                ) : (
                  <Circle className="text-charcoal-300 size-4" aria-hidden />
                )}
                <span className={r.done ? "text-charcoal-600" : "text-charcoal-900 font-medium"}>{r.label}</span>
                <span className="sr-only">{r.done ? "(done)" : "(to do)"}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {d.kitchen.delayedTickets > 0 ? (
        <Link
          href={`${base}/kitchen`}
          className="border-warning-500/40 bg-warning-50 text-warning-700 mb-6 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          <span>
            <strong>{d.kitchen.delayedTickets}</strong> kitchen ticket
            {d.kitchen.delayedTickets === 1 ? " has" : "s have"} been waiting longer than {d.kitchen.delayMinutes}{" "}
            minutes.
          </span>
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`Orders · ${rangeLabel}`} value={d.orders.total} hint={`${d.orders.cancelled} cancelled`} />
        <Stat
          label="Active now"
          value={d.orders.active}
          hint={`${d.kitchen.waitingTickets} tickets in the kitchen`}
          tone={d.kitchen.delayedTickets > 0 ? "alert" : "default"}
        />
        <Stat
          label="Order value"
          value={money(d.money.orderValueMinor)}
          hint={`Avg ${money(d.money.averageOrderMinor)} · excl. cancelled`}
        />
        <Stat
          label="Collected"
          value={money(d.money.collectedMinor)}
          hint={`${d.money.paymentsCount} payment${d.money.paymentsCount === 1 ? "" : "s"} recorded ·${money(d.money.outstandingMinor)} unpaid`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {d.daily.length > 0 ? (
            <Card>
              <CardHeader title="Daily order value" description={`Last ${rangeLabel}, excluding cancelled orders`} />
              <div className="px-5 py-4">
                <DailyBars data={d.daily} currency={d.currency} locale={ctx.tenant.locale} />
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Recent activity"
              action={
                <ButtonLink href={`${base}/orders`} variant="ghost" size="sm">
                  All orders
                </ButtonLink>
              }
            />
            {d.recent.length === 0 ? (
              <EmptyState
                title="No activity yet"
                description="Orders and status changes will appear here as they happen."
              />
            ) : (
              <ul className="divide-ivory-200 divide-y">
                {d.recent.map((r) => (
                  <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular text-charcoal-500 w-12 shrink-0 text-xs">
                      {formatTime(r.at, tz, ctx.tenant.locale)}
                    </span>
                    <Link
                      href={`${base}/orders/${r.orderId}`}
                      className="text-forest-700 font-mono font-medium hover:underline"
                    >
                      #{r.reference}
                    </Link>
                    <span className="text-charcoal-500 hidden sm:inline">
                      {r.tableLabel ? `Table ${r.tableLabel}` : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <span className="text-charcoal-500 hidden text-xs sm:inline">{r.actor}</span>
                      <OrderStatusBadge status={r.to} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Popular items" description={`By quantity, ${rangeLabel}`} />
            {d.popular.length === 0 ? (
              <EmptyState title="No items sold yet" />
            ) : (
              <ol className="divide-ivory-200 divide-y">
                {d.popular.map((p, i) => (
                  <li key={p.name} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="tabular text-charcoal-400 w-5 text-xs">{i + 1}</span>
                    <span className="flex-1 truncate font-medium">{p.name}</span>
                    <span className="tabular text-charcoal-600">{p.quantity}×</span>
                    <span className="tabular text-charcoal-500 w-28 text-right">{money(p.valueMinor)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <Card>
            <CardHeader title="Order status" />
            <ul className="bg-ivory-200 grid grid-cols-2 gap-px text-sm">
              {["PLACED", "PREPARING", "READY", "SERVED", "COMPLETED", "CANCELLED"].map((s) => (
                <li key={s} className="flex items-center justify-between bg-white px-5 py-2.5">
                  <span className="text-charcoal-600">{ORDER_STATUS_LABEL[s]}</span>
                  <span className="tabular font-semibold">
                    {(d.orders.byStatus[s] ?? 0) +
                      (s === "PREPARING" ? (d.orders.byStatus.ACKNOWLEDGED ?? 0) : 0) +
                      (s === "READY" ? (d.orders.byStatus.OUT_FOR_DELIVERY ?? 0) : 0)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Payments by method" description="Recorded by staff at the restaurant" />
            {d.money.byMethod.length === 0 ? (
              <EmptyState title="No payments recorded" />
            ) : (
              <ul className="divide-ivory-200 divide-y text-sm">
                {d.money.byMethod.map((m) => (
                  <li key={m.method} className="flex justify-between px-5 py-2.5">
                    <span>{PAYMENT_METHOD_LABEL[m.method]}</span>
                    <span className="tabular font-medium">{money(m.amountMinor)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {d.branches.length > 1 || ctx.branchRoles.size > 1 ? (
            <Card>
              <CardHeader title="Branches" />
              <Table>
                <thead>
                  <tr>
                    <Th>Branch</Th>
                    <Th className="text-right">Orders</Th>
                    <Th className="text-right">Value</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.branches.map((b) => (
                    <tr key={b.id}>
                      <Td>
                        <Link href={`${base}?range=${range}&branch=${b.id}`} className="font-medium hover:underline">
                          {b.name}
                        </Link>
                      </Td>
                      <Td className="tabular text-right">{b.orders}</Td>
                      <Td className="tabular text-right">{money(b.valueMinor)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {branchId ? (
                <div className="px-5 py-3">
                  <Link href={`${base}?range=${range}`} className="text-forest-700 text-sm font-medium hover:underline">
                    Show all branches
                  </Link>
                </div>
              ) : null}
            </Card>
          ) : null}

          {(d.unavailableItems > 0 || d.openRequests > 0) && (
            <Card className="text-charcoal-700 px-5 py-4 text-sm">
              {d.unavailableItems > 0 ? (
                <p>
                  <Link href={`${base}/menu`} className="text-forest-700 font-medium hover:underline">
                    {d.unavailableItems} menu item{d.unavailableItems === 1 ? " is" : "s are"} marked unavailable
                  </Link>
                </p>
              ) : null}
              {d.openRequests > 0 ? (
                <p className="mt-1">
                  <Link href={`${base}/floor`} className="text-forest-700 font-medium hover:underline">
                    {d.openRequests} open waiter call{d.openRequests === 1 ? "" : "s"} / bill request
                    {d.openRequests === 1 ? "" : "s"}
                  </Link>
                </p>
              ) : null}
            </Card>
          )}
        </div>
      </div>
      {(d.money.taxAddedMinor > 0 || d.money.taxIncludedMinor > 0 || d.money.serviceChargeMinor > 0) && (
        <p className="text-charcoal-500 mt-6 text-xs">
          Included in order value: service charge {money(d.money.serviceChargeMinor)}
          {d.money.taxAddedMinor > 0 ? ` · tax added ${money(d.money.taxAddedMinor)}` : ""}
          {d.money.taxIncludedMinor > 0 ? ` · tax contained in prices ${money(d.money.taxIncludedMinor)}` : ""}. Figures
          are operational, not accounting statements.
        </p>
      )}
    </>
  );
}
