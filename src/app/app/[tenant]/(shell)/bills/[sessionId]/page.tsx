import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { can } from "@/server/authz";
import { isAppError } from "@/server/errors";
import { requireTenantPage } from "@/server/session";
import { getSessionBill } from "@/server/services/payments";
import { formatMoney, formatTime } from "@/lib/format";
import { settleSessionAction } from "../../orders/actions";
import { closeSessionAction } from "../../tables/actions";
import { PaymentForm } from "../../orders/payment-form";

export const metadata: Metadata = { title: "Table bill" };
export const dynamic = "force-dynamic";

/** The whole table's bill: every order in the dining session, payable together or per order. */
export default async function BillPage({ params }: { params: Promise<{ tenant: string; sessionId: string }> }) {
  const { tenant: slug, sessionId } = await params;
  const ctx = await requireTenantPage(slug);
  const bill = await getSessionBill(ctx, sessionId).catch((e) => {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  });
  const { session } = bill;
  const cur = ctx.tenant.currency;
  const loc = ctx.tenant.locale;
  const money = (m: number) => formatMoney(m, cur, loc);
  const canPay = ctx.tenant.status !== "SUSPENDED" && can(ctx, "payments.record", session.branchId);

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/floor?branch=${session.branchId}`} className="text-forest-700 hover:underline">
          ← Floor
        </Link>
      </p>
      <PageHeader
        title={`Table ${session.table.label} · bill`}
        description={`Seated ${formatTime(session.openedAt, ctx.tenant.timezone, loc)} · ${session.orders.length} order${session.orders.length === 1 ? "" : "s"}${session.status !== "OPEN" ? ` · session ${session.status.toLowerCase()}` : ""}`}
        actions={
          session.status === "OPEN" && bill.outstandingMinor === 0 && canPay ? (
            <ActionButton
              action={closeSessionAction.bind(null, slug)}
              fields={{ sessionId: session.id }}
              size="md"
              confirm="Mark this table as free for the next guests?"
            >
              Free the table
            </ActionButton>
          ) : null
        }
      />
      <div className="grid max-w-5xl gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Orders at this table" />
          {session.orders.length === 0 ? (
            <p className="text-charcoal-500 px-5 py-4 text-sm">No orders yet.</p>
          ) : (
            <ul className="divide-ivory-200 divide-y">
              {session.orders.map((o) => (
                <li key={o.id} className="px-5 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/${slug}/orders/${o.id}`}
                      className="text-forest-700 font-mono font-semibold hover:underline"
                    >
                      #{o.reference}
                    </Link>
                    {o.customerName ? <span className="text-charcoal-500 text-sm">{o.customerName}</span> : null}
                    <OrderStatusBadge status={o.status} />
                    <PaymentStatusBadge status={o.paymentStatus} />
                    <span className="tabular ml-auto font-semibold">{money(o.totalMinor)}</span>
                  </div>
                  <ul className="text-charcoal-600 mt-1 text-sm">
                    {o.items.map((i) => (
                      <li key={i.id} className="flex justify-between gap-3">
                        <span>
                          {i.quantity}× {i.nameSnapshot}
                          {i.variantNameSnapshot ? ` · ${i.variantNameSnapshot}` : ""}
                          {i.modifiers.length ? ` (${i.modifiers.map((m) => m.nameSnapshot).join(", ")})` : ""}
                        </span>
                        <span className="tabular">{money(i.lineTotalMinor)}</span>
                      </li>
                    ))}
                  </ul>
                  {o.amountPaidMinor > 0 && o.amountPaidMinor < o.totalMinor ? (
                    <p className="text-warning-700 mt-1 text-xs">Paid so far {money(o.amountPaidMinor)}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <dl className="border-ivory-200 space-y-1 border-t px-5 py-4 text-sm">
            <div className="flex justify-between">
              <dt>Table total</dt>
              <dd className="tabular">{money(bill.totalMinor)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Paid</dt>
              <dd className="tabular">{money(bill.paidMinor)}</dd>
            </div>
            <div className="flex justify-between text-base font-semibold">
              <dt>Still to pay</dt>
              <dd className="tabular">{money(bill.outstandingMinor)}</dd>
            </div>
          </dl>
        </Card>

        {canPay && session.orders.length > 0 ? (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader
                title="Settle the whole table"
                description={
                  bill.outstandingMinor > 0
                    ? "Pays every open balance with one method."
                    : "Everything at this table is paid."
                }
              />
              <div className="px-5 py-5">
                <PaymentForm
                  action={settleSessionAction.bind(null, slug)}
                  hidden={{ sessionId: session.id }}
                  dueMinor={bill.outstandingMinor}
                  currency={cur}
                  locale={loc}
                  fixedAmount
                  submitLabel="Settle table"
                />
              </div>
            </Card>
            <p className="text-charcoal-600 text-sm">
              Splitting the bill? Open each order and record each guest&apos;s payment separately — partial payments are
              allowed.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
}
