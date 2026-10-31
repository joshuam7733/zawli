import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, Printer } from "lucide-react";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Field, Input, PageHeader } from "@/components/ui";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { can } from "@/server/authz";
import { isAppError } from "@/server/errors";
import { requireTenantPage } from "@/server/session";
import { getOrderDetail } from "@/server/services/orders";
import { formatDateTime, formatMoney, formatTime, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/format";
import {
  cancelAction,
  completeAction,
  recordPaymentAction,
  reprintAction,
  serveAction,
  voidPaymentAction,
} from "../actions";
import { PaymentForm } from "../payment-form";

export const metadata: Metadata = { title: "Order" };
export const dynamic = "force-dynamic";

export default async function OrderDetailPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await requireTenantPage(slug);
  const order = await getOrderDetail(ctx, id).catch((e) => {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  });
  const tz = ctx.tenant.timezone;
  const loc = ctx.tenant.locale;
  const money = (m: number | null) => (m == null ? "—" : formatMoney(m, order.currency, loc));
  const writable = ctx.tenant.status !== "SUSPENDED";
  const canServe = writable && can(ctx, "orders.serve", order.branchId);
  const canCancel =
    writable &&
    can(ctx, "orders.cancel", order.branchId) &&
    !["SERVED", "COMPLETED", "CANCELLED"].includes(order.status);
  const canPay = writable && can(ctx, "payments.record", order.branchId) && order.status !== "CANCELLED";
  const canVoid = writable && can(ctx, "payments.void", order.branchId);
  const due = order.showMoney ? (order.totalMinor ?? 0) - (order.amountPaidMinor ?? 0) : 0;
  const printable = order.branch.fulfillmentMode !== "DIGITAL_DISPLAY";

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/orders`} className="text-forest-700 hover:underline">
          ← Orders
        </Link>
      </p>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            <span className="font-mono">#{order.reference}</span>
            <OrderStatusBadge status={order.status} />
            {order.showMoney ? <PaymentStatusBadge status={order.paymentStatus} /> : null}
          </span>
        }
        description={`${order.tableLabel ? `Table ${order.tableLabel} · ` : ""}${order.branch.name} · placed ${formatDateTime(order.placedAt, tz, loc)}${order.customerName ? ` · ${order.customerName}` : ""}`}
        actions={
          <>
            {canServe && order.status === "READY" ? (
              <ActionButton
                action={serveAction.bind(null, slug)}
                fields={{ orderId: order.id, to: "OUT_FOR_DELIVERY" }}
                size="md"
              >
                Taking it to the table
              </ActionButton>
            ) : null}
            {canServe && (order.status === "READY" || order.status === "OUT_FOR_DELIVERY") ? (
              <ActionButton
                action={serveAction.bind(null, slug)}
                fields={{ orderId: order.id, to: "SERVED" }}
                variant="accent"
                size="md"
              >
                Mark served
              </ActionButton>
            ) : null}
            {canServe && order.status === "SERVED" && order.paymentStatus === "PAID" ? (
              <ActionButton action={completeAction.bind(null, slug)} fields={{ orderId: order.id }} size="md">
                Complete
              </ActionButton>
            ) : null}
          </>
        }
      />

      {order.status === "CANCELLED" ? (
        <div
          role="status"
          className="bg-danger-50 text-danger-700 ring-danger-600/20 mb-6 rounded-md px-4 py-3 text-sm ring-1"
        >
          Cancelled {order.cancelledAt ? formatDateTime(order.cancelledAt, tz, loc) : ""} — {order.cancelReason}
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Items" />
            <ul className="divide-ivory-200 divide-y">
              {order.items.map((i) => (
                <li key={i.id} className="flex gap-4 px-5 py-3">
                  <span className="tabular w-8 font-semibold">{i.quantity}×</span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {i.nameSnapshot}
                      {i.variantNameSnapshot ? (
                        <span className="text-charcoal-500"> · {i.variantNameSnapshot}</span>
                      ) : null}
                    </p>
                    {i.modifiers.length ? (
                      <p className="text-charcoal-600 text-sm">{i.modifiers.map((m) => m.nameSnapshot).join(", ")}</p>
                    ) : null}
                    {i.note ? <p className="text-warning-700 text-sm">Note: {i.note}</p> : null}
                    {i.allergensSnapshot ? (
                      <p className="text-danger-700 inline-flex items-center gap-1 text-sm font-medium">
                        <AlertTriangle className="size-3.5" aria-hidden /> {i.allergensSnapshot}
                      </p>
                    ) : null}
                    {i.station ? <p className="text-charcoal-500 text-xs">Station: {i.station.name}</p> : null}
                  </div>
                  {order.showMoney ? <span className="tabular text-right">{money(i.lineTotalMinor)}</span> : null}
                </li>
              ))}
            </ul>
            {order.customerNote ? (
              <p className="border-ivory-200 text-info-700 border-t px-5 py-3 text-sm">
                Order note: {order.customerNote}
              </p>
            ) : null}
            {order.showMoney ? (
              <dl className="border-ivory-200 space-y-1 border-t px-5 py-4 text-sm">
                <Row label="Subtotal" value={money(order.subtotalMinor)} />
                {order.serviceChargeMinor ? (
                  <Row label="Service charge" value={money(order.serviceChargeMinor)} />
                ) : null}
                {order.taxMinor ? <Row label="Tax" value={money(order.taxMinor)} /> : null}
                <Row label="Total" value={money(order.totalMinor)} strong />
                {order.taxIncludedMinor ? (
                  <Row label="Tax included in prices" value={money(order.taxIncludedMinor)} muted />
                ) : null}
                <Row label="Paid" value={money(order.amountPaidMinor)} />
                <Row label="Balance due" value={money(due)} strong />
              </dl>
            ) : null}
          </Card>

          {order.showMoney ? (
            <Card>
              <CardHeader title="Payments" description="Money received at the restaurant, recorded by staff." />
              {order.payments.length === 0 ? (
                <p className="text-charcoal-500 px-5 py-4 text-sm">
                  No payments recorded yet. Serving an order does not mark it paid.
                </p>
              ) : (
                <ul className="divide-ivory-200 divide-y">
                  {order.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <span
                        className={
                          p.status === "VOIDED"
                            ? "tabular text-charcoal-400 font-semibold line-through"
                            : "tabular font-semibold"
                        }
                      >
                        {money(p.amountMinor)}
                      </span>
                      <span>{PAYMENT_METHOD_LABEL[p.method]}</span>
                      {p.reference ? <span className="text-charcoal-500 font-mono text-xs">{p.reference}</span> : null}
                      <span className="text-charcoal-500">
                        {formatTime(p.recordedAt, tz, loc)} ·{" "}
                        {p.recordedBy?.name ??
                          (p.source === "PROVIDER" ? `${p.note ?? "Mobile money"} (confirmed)` : "—")}
                      </span>
                      {p.status === "VOIDED" ? (
                        <Badge tone="danger" title={p.voidReason ?? undefined}>
                          Voided by {p.voidedBy?.name}: {p.voidReason}
                        </Badge>
                      ) : canVoid ? (
                        <details className="relative ml-auto">
                          <summary className="text-danger-700 hover:bg-danger-50 cursor-pointer list-none rounded-md px-2 py-1 text-sm [&::-webkit-details-marker]:hidden">
                            Void
                          </summary>
                          <div className="border-ivory-200 shadow-pop absolute right-0 z-20 mt-1 w-72 rounded-lg border bg-white p-4">
                            <ActionForm
                              action={voidPaymentAction.bind(null, slug)}
                              submitLabel="Void payment"
                              submitVariant="danger"
                            >
                              <input type="hidden" name="paymentId" value={p.id} />
                              <Field
                                label="Reason"
                                htmlFor={`void-${p.id}`}
                                hint="Recorded in the activity log. Refund the guest outside Zawli."
                              >
                                <Input id={`void-${p.id}`} name="reason" required minLength={3} maxLength={300} />
                              </Field>
                            </ActionForm>
                          </div>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {canPay && (due > 0 || order.payments.length > 0) ? (
                <div className="border-ivory-200 border-t px-5 py-5">
                  <PaymentForm
                    action={recordPaymentAction.bind(null, slug)}
                    hidden={{ orderId: order.id }}
                    dueMinor={due}
                    currency={order.currency}
                    locale={loc}
                  />
                </div>
              ) : null}
              {order.tableSessionId && canPay && order.status !== "COMPLETED" ? (
                <p className="border-ivory-200 border-t px-5 py-3 text-sm">
                  <Link
                    href={`/app/${slug}/bills/${order.tableSessionId}`}
                    className="text-forest-700 font-medium hover:underline"
                  >
                    See the whole table&apos;s bill →
                  </Link>
                </p>
              ) : null}
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader title="Kitchen tickets" />
            <ul className="divide-ivory-200 divide-y text-sm">
              {order.tickets.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 px-5 py-3">
                  <span className="font-medium">{t.station.name}</span>
                  <Badge>{ORDER_STATUS_LABEL[t.status] ?? t.status}</Badge>
                  {t.printJobs.map((j) => (
                    <Badge
                      key={j.id}
                      tone={j.status === "PRINTED" ? "forest" : j.status === "FAILED" ? "danger" : "warning"}
                    >
                      {j.printer.name}: {j.status.toLowerCase()}
                    </Badge>
                  ))}
                  {printable ? (
                    <span className="ml-auto flex gap-1">
                      <a
                        href={`/app/${slug}/print/ticket/${t.id}`}
                        target="_blank"
                        rel="noopener"
                        className="text-forest-700 hover:bg-ivory-100 inline-flex items-center gap-1 rounded-md px-2 py-1"
                      >
                        <Printer className="size-3.5" aria-hidden /> Print
                      </a>
                      {writable ? (
                        <ActionButton
                          action={reprintAction.bind(null, slug)}
                          fields={{ ticketId: t.id }}
                          variant="ghost"
                        >
                          Queue reprint
                        </ActionButton>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="History" />
            <ol className="px-5 py-4 text-sm">
              {order.statusHistory.map((h) => (
                <li key={h.id} className="border-ivory-200 relative border-l-2 pb-3 pl-4 last:pb-0">
                  <span className="bg-forest-600 absolute top-1 -left-[5px] size-2 rounded-full" aria-hidden />
                  <p className="font-medium">{ORDER_STATUS_LABEL[h.toStatus]}</p>
                  <p className="text-charcoal-500 text-xs">
                    {formatTime(h.createdAt, tz, loc)} ·{" "}
                    {h.actor?.name ?? (h.actorType === "CUSTOMER" ? "Customer (QR)" : "System")}
                    {h.reason ? ` · ${h.reason}` : ""}
                  </p>
                </li>
              ))}
            </ol>
          </Card>

          {canCancel ? (
            <Card>
              <CardHeader
                title="Cancel order"
                description={
                  order.amountPaidMinor ? "Void recorded payments first." : "The kitchen tickets are cancelled too."
                }
              />
              <div className="px-5 py-4">
                <ActionForm action={cancelAction.bind(null, slug)} submitLabel="Cancel order" submitVariant="danger">
                  <input type="hidden" name="orderId" value={order.id} />
                  <Field label="Reason" htmlFor="cancel-reason">
                    <Input
                      id="cancel-reason"
                      name="reason"
                      required
                      minLength={3}
                      maxLength={300}
                      placeholder="e.g. Guest left, duplicate order"
                    />
                  </Field>
                </ActionForm>
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "font-semibold" : ""} ${muted ? "text-charcoal-500" : ""}`}>
      <dt>{label}</dt>
      <dd className="tabular">{value}</dd>
    </div>
  );
}
