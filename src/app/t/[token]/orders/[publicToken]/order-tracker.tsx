"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, CheckCircle2 } from "lucide-react";
import type { PublicOrder } from "@/server/services/ordering";
import { formatMoney, formatTime } from "@/lib/format";
import { readableOn } from "@/lib/color";
import { cn } from "@/lib/cn";
import { PayPanel } from "./pay-panel";

type Order = Omit<PublicOrder, "placedAt" | "readyAt" | "servedAt" | "paymentDueBy"> & {
  placedAt: string;
  readyAt: string | null;
  servedAt: string | null;
  paymentDueBy: string | null;
};

const STEPS = [
  { key: "PLACED", label: "Sent to the kitchen" },
  { key: "PREPARING", label: "Being prepared" },
  { key: "READY", label: "Ready" },
  { key: "SERVED", label: "Served" },
] as const;
const RANK: Record<string, number> = {
  PLACED: 0,
  ACKNOWLEDGED: 1,
  PREPARING: 1,
  READY: 2,
  OUT_FOR_DELIVERY: 2,
  SERVED: 3,
  COMPLETED: 3,
  CANCELLED: -1,
};

export function OrderTracker({
  initial,
  publicToken,
  menuHref,
}: {
  initial: Order;
  publicToken: string;
  menuHref: string;
}) {
  const [order, setOrder] = useState(initial);
  const [offline, setOffline] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const awaitingPayment = order.paymentRequired;

  useEffect(() => {
    // While awaiting payment we always poll (fast), even if progress tracking is off.
    if (order.isFinal || (!order.trackingEnabled && !awaitingPayment)) return;
    let stopped = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/public/orders/${publicToken}`, { cache: "no-store" });
        if (res.ok) {
          setOrder(await res.json());
          setOffline(false);
        }
      } catch {
        setOffline(true);
      }
    };
    if (refreshKey > 0) void tick();
    const id = setInterval(
      () => !stopped && document.visibilityState === "visible" && tick(),
      awaitingPayment ? 3_000 : 8_000,
    );
    const onVis = () => document.visibilityState === "visible" && tick();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [order.isFinal, order.trackingEnabled, awaitingPayment, publicToken, refreshKey]);

  const r = order.restaurant;
  const money = (m: number) => formatMoney(m, order.currency, r.locale);
  const rank = RANK[order.status] ?? 0;
  const headerText = readableOn(r.brandPrimary);

  return (
    <div className="bg-ivory-50 min-h-dvh pb-12">
      <header style={{ background: r.brandPrimary, color: headerText }} className="px-5 py-6">
        <div className="mx-auto max-w-lg">
          <p className="text-sm opacity-80">
            {r.name} · {r.branchName}
          </p>
          <h1 className="font-display mt-1 text-2xl font-semibold">
            Order <span className="font-mono">#{order.reference}</span>
          </h1>
          {order.tableLabel ? <p className="text-sm opacity-80">Table {order.tableLabel}</p> : null}
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4">
        {order.status === "CANCELLED" ? (
          <div
            role="alert"
            className="bg-danger-50 text-danger-700 ring-danger-600/20 mt-5 rounded-lg px-4 py-4 ring-1"
          >
            <p className="font-semibold">This order was cancelled.</p>
            {order.cancelReason ? <p className="mt-1 text-sm">{order.cancelReason}</p> : null}
            <p className="mt-1 text-sm">Please speak to a member of staff.</p>
          </div>
        ) : awaitingPayment ? (
          <PayPanel order={order} publicToken={publicToken} onChanged={() => setRefreshKey((k) => k + 1)} />
        ) : (
          <div className="border-ivory-200 shadow-card mt-5 rounded-lg border bg-white p-5">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="text-forest-600 size-6" aria-hidden />
              <p className="font-semibold">
                {order.status === "COMPLETED"
                  ? "All done — thank you!"
                  : rank >= 3
                    ? "Enjoy your meal!"
                    : rank === 2
                      ? "Your order is ready"
                      : "We've got your order"}
              </p>
            </div>
            {order.trackingEnabled ? (
              <ol className="mt-5 flex flex-col gap-3" aria-label="Order progress">
                {STEPS.map((s, i) => {
                  const done = rank >= i;
                  const current = rank === i;
                  return (
                    <li key={s.key} className="flex items-center gap-3" aria-current={current ? "step" : undefined}>
                      <span
                        className={cn(
                          "grid size-7 place-items-center rounded-full border-2 text-xs",
                          done ? "border-forest-700 bg-forest-700 text-ivory-50" : "border-ivory-300 text-charcoal-400",
                        )}
                      >
                        {done ? <Check className="size-4" aria-hidden /> : i + 1}
                      </span>
                      <span
                        className={cn(
                          "text-sm",
                          current
                            ? "text-charcoal-950 font-semibold"
                            : done
                              ? "text-charcoal-700"
                              : "text-charcoal-400",
                        )}
                      >
                        {s.label}
                      </span>
                      {current && rank < 3 ? (
                        <span className="animate-pulse-soft ml-auto size-2 rounded-full bg-lime-500" aria-hidden />
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <p className="text-charcoal-500 mt-4 text-xs">
              Placed at {formatTime(order.placedAt, r.timezone, r.locale)}
              {offline ? " · reconnecting…" : order.isFinal ? "" : " · updates automatically"}
            </p>
          </div>
        )}

        <section className="border-ivory-200 shadow-card mt-5 rounded-lg border bg-white p-5">
          <h2 className="font-semibold">Order summary</h2>
          <ul className="divide-ivory-200 mt-3 divide-y text-sm">
            {order.items.map((i, idx) => (
              <li key={idx} className="flex gap-3 py-2">
                <span className="tabular w-6 font-semibold">{i.quantity}×</span>
                <span className="flex-1">
                  {i.name}
                  {i.variant ? ` · ${i.variant}` : ""}
                  {i.modifiers.length ? (
                    <span className="text-charcoal-500 block">{i.modifiers.join(", ")}</span>
                  ) : null}
                  {i.note ? <span className="text-charcoal-500 block italic">“{i.note}”</span> : null}
                </span>
                <span className="tabular">{money(i.lineTotalMinor)}</span>
              </li>
            ))}
          </ul>
          <dl className="border-ivory-200 mt-3 space-y-1 border-t pt-3 text-sm">
            {order.serviceChargeMinor > 0 ? (
              <div className="text-charcoal-600 flex justify-between">
                <dt>{order.serviceChargeLabel}</dt>
                <dd className="tabular">{money(order.serviceChargeMinor)}</dd>
              </div>
            ) : null}
            {order.taxMinor > 0 ? (
              <div className="text-charcoal-600 flex justify-between">
                <dt>{order.taxLabel}</dt>
                <dd className="tabular">{money(order.taxMinor)}</dd>
              </div>
            ) : null}
            <div className="flex justify-between text-base font-semibold">
              <dt>Total</dt>
              <dd className="tabular">{money(order.totalMinor)}</dd>
            </div>
            <div className="text-charcoal-600 flex justify-between">
              <dt>Payment</dt>
              <dd>
                {order.paymentStatus === "PAID"
                  ? "Paid — thank you"
                  : order.paymentStatus === "PARTIALLY_PAID"
                    ? "Partly paid"
                    : awaitingPayment
                      ? "Pay by mobile money (above)"
                      : "Pay at the restaurant"}
              </dd>
            </div>
          </dl>
        </section>
        <Link
          href={menuHref}
          className="border-ivory-300 text-charcoal-900 hover:bg-ivory-100 mt-6 flex h-12 items-center justify-center rounded-lg border bg-white font-medium"
        >
          Order something else
        </Link>
      </main>
    </div>
  );
}
