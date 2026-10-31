"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Bell, CheckCircle2, Receipt, UtensilsCrossed } from "lucide-react";
import type { FloorBoard } from "@/server/services/floor";
import { ConnectionPill } from "@/components/connection-pill";
import { postJson, useLiveBoard, useNow } from "@/components/use-live-board";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { elapsed, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

type Tab = "attention" | "tables" | "orders";

export function FloorScreen({
  tenantSlug,
  tenantName,
  locale,
  branches,
  initial,
}: {
  tenantSlug: string;
  tenantName: string;
  locale: string;
  timezone: string;
  branches: { id: string; name: string }[];
  initial: FloorBoard;
}) {
  const router = useRouter();
  const branchId = initial.branch.id;
  const { board, refetch, connection } = useLiveBoard(
    `/api/app/${tenantSlug}/floor?branch=${branchId}`,
    `/api/app/${tenantSlug}/events?branch=${branchId}`,
    initial,
  );
  const now = useNow(20_000);
  const [tab, setTab] = useState<Tab>("attention");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const money = (m: number) => formatMoney(m, board.currency, locale);
  const base = `/app/${tenantSlug}`;

  const ready = useMemo(
    () => board.orders.filter((o) => o.status === "READY" || o.status === "OUT_FOR_DELIVERY"),
    [board.orders],
  );
  const attention = board.requests.length + ready.length;

  async function run(key: string, url: string, body: unknown) {
    setBusy((b) => new Set(b).add(key));
    setError(null);
    const err = await postJson(url, body);
    if (err) setError(err);
    await refetch();
    setBusy((b) => {
      const n = new Set(b);
      n.delete(key);
      return n;
    });
  }

  return (
    <div className="bg-ivory-50 min-h-dvh pb-10">
      <header className="bg-forest-900 text-ivory-50 sticky top-0 z-10">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link href={`${base}/orders`} className="rounded-md p-1.5 hover:bg-white/10" aria-label="Back to orders">
            <ArrowLeft className="size-5" />
          </Link>
          <div className="mr-auto min-w-0">
            <h1 className="truncate font-semibold">Floor · {board.branch.name}</h1>
            <p className="text-ivory-200/70 truncate text-xs">{tenantName}</p>
          </div>
          <ConnectionPill connection={connection} dark />
        </div>
        {branches.length > 1 ? (
          <div className="px-4 pb-2">
            <select
              aria-label="Branch"
              value={branchId}
              onChange={(e) => router.push(`${base}/floor?branch=${e.target.value}`)}
              className="bg-forest-800 text-ivory-50 h-9 w-full rounded-md px-2 text-sm"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <nav role="tablist" className="flex border-t border-white/10">
          {(
            [
              ["attention", `Needs you${attention ? ` (${attention})` : ""}`],
              ["tables", "Tables"],
              ["orders", `Orders (${board.orders.length})`],
            ] as [Tab, string][]
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "flex-1 border-b-2 py-2.5 text-sm font-medium",
                tab === k ? "text-ivory-50 border-lime-400" : "text-ivory-200/70 border-transparent",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {error ? (
        <p
          role="alert"
          className="bg-danger-50 text-danger-700 ring-danger-600/20 mx-4 mt-3 rounded-md px-3 py-2 text-sm ring-1"
        >
          {error}
        </p>
      ) : null}

      <main className="mx-auto max-w-3xl px-4 pt-4">
        {tab === "attention" ? (
          attention === 0 ? (
            <div className="py-16 text-center">
              <CheckCircle2 className="text-forest-600 mx-auto size-8" aria-hidden />
              <p className="mt-2 font-semibold">All caught up</p>
              <p className="text-charcoal-500 text-sm">Waiter calls, bill requests and ready orders appear here.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-3">
              {board.requests.map((r) => (
                <li
                  key={r.id}
                  className={cn(
                    "shadow-card rounded-lg border bg-white p-4",
                    r.status === "OPEN" ? "border-warning-500/60" : "border-ivory-200",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "grid size-10 shrink-0 place-items-center rounded-full",
                        r.type === "BILL" ? "bg-info-50 text-info-700" : "bg-warning-50 text-warning-700",
                      )}
                    >
                      {r.type === "BILL" ? (
                        <Receipt className="size-5" aria-hidden />
                      ) : (
                        <Bell className="size-5" aria-hidden />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        Table {r.tableLabel} · {r.type === "BILL" ? "wants the bill" : "needs a waiter"}
                      </p>
                      <p className="text-charcoal-500 text-sm">
                        {elapsed(r.createdAt, now)} ago{r.acknowledgedBy ? ` · ${r.acknowledgedBy} is on it` : ""}
                      </p>
                      {r.note ? <p className="mt-1 text-sm italic">“{r.note}”</p> : null}
                    </div>
                  </div>
                  {board.canServe ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {r.status === "OPEN" ? (
                        <button
                          disabled={busy.has(r.id)}
                          onClick={() =>
                            run(r.id, `/api/app/${tenantSlug}/service-requests/${r.id}`, { action: "acknowledge" })
                          }
                          className="border-ivory-300 hover:bg-ivory-100 h-11 flex-1 rounded-md border bg-white text-sm font-medium disabled:opacity-50"
                        >
                          I&apos;m on it
                        </button>
                      ) : null}
                      {r.type === "BILL" && r.tableSessionId && board.canRecordPayments ? (
                        <Link
                          href={`${base}/bills/${r.tableSessionId}`}
                          className="bg-forest-800 text-ivory-50 hover:bg-forest-700 grid h-11 flex-1 place-items-center rounded-md text-sm font-medium"
                        >
                          Open bill
                        </Link>
                      ) : null}
                      <button
                        disabled={busy.has(r.id)}
                        onClick={() =>
                          run(r.id, `/api/app/${tenantSlug}/service-requests/${r.id}`, { action: "resolve" })
                        }
                        className="text-charcoal-950 h-11 flex-1 rounded-md bg-lime-400 text-sm font-semibold hover:bg-lime-300 disabled:opacity-50"
                      >
                        Done
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
              {ready.map((o) => (
                <li key={o.id} className="shadow-card rounded-lg border border-lime-500/60 bg-white p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-charcoal-900 grid size-10 shrink-0 place-items-center rounded-full bg-lime-300/60">
                      <UtensilsCrossed className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">
                        Table {o.tableLabel ?? "—"} · order <span className="font-mono">#{o.reference}</span> is{" "}
                        {o.status === "READY" ? "ready" : "on the way"}
                      </p>
                      <p className="text-charcoal-500 text-sm">
                        Ready {o.readyAt ? `${elapsed(o.readyAt, now)} ago` : ""}
                        {o.customerName ? ` · for ${o.customerName}` : ""}
                      </p>
                      <ItemList items={o.items} />
                    </div>
                  </div>
                  {board.canServe ? (
                    <div className="mt-3 flex gap-2">
                      {o.status === "READY" ? (
                        <button
                          disabled={busy.has(o.id)}
                          onClick={() =>
                            run(o.id, `/api/app/${tenantSlug}/orders/${o.id}/serve`, { to: "OUT_FOR_DELIVERY" })
                          }
                          className="border-ivory-300 hover:bg-ivory-100 h-11 flex-1 rounded-md border bg-white text-sm font-medium disabled:opacity-50"
                        >
                          Taking it
                        </button>
                      ) : null}
                      <button
                        disabled={busy.has(o.id)}
                        onClick={() => run(o.id, `/api/app/${tenantSlug}/orders/${o.id}/serve`, { to: "SERVED" })}
                        className="text-charcoal-950 h-11 flex-1 rounded-md bg-lime-400 text-sm font-semibold hover:bg-lime-300 disabled:opacity-50"
                      >
                        Served
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "tables" ? (
          board.tables.length === 0 ? (
            <p className="text-charcoal-500 py-16 text-center">No active tables at this branch.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {board.tables.map((t) => (
                <li key={t.id}>
                  <div
                    className={cn(
                      "shadow-card flex h-full flex-col rounded-lg border bg-white p-3",
                      t.requests.length
                        ? "border-warning-500"
                        : t.readyOrders
                          ? "border-lime-500"
                          : t.session
                            ? "border-forest-600/40"
                            : "border-ivory-200",
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <p className="font-display text-2xl font-semibold">{t.label}</p>
                      {t.requests.includes("ASSISTANCE") ? (
                        <Bell className="text-warning-700 size-4" aria-label="Waiter called" />
                      ) : null}
                      {t.requests.includes("BILL") ? (
                        <Receipt className="text-info-700 size-4" aria-label="Bill requested" />
                      ) : null}
                    </div>
                    <p className="text-charcoal-500 text-xs">{t.area ?? ""}</p>
                    <p className="mt-2 text-sm">
                      {t.session ? (
                        <>
                          {t.openOrders} open order{t.openOrders === 1 ? "" : "s"}
                          {t.readyOrders ? (
                            <span className="text-forest-700 font-semibold"> · {t.readyOrders} ready</span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-charcoal-500">Free</span>
                      )}
                    </p>
                    {t.session?.stale ? <p className="text-warning-700 text-xs">No activity for a while</p> : null}
                    {t.session && t.outstandingMinor != null && t.outstandingMinor > 0 ? (
                      <p className="tabular mt-1 text-sm font-semibold">{money(t.outstandingMinor)} due</p>
                    ) : null}
                    {t.session && board.canRecordPayments ? (
                      <Link
                        href={`${base}/bills/${t.session.id}`}
                        className="text-forest-700 mt-auto pt-2 text-sm font-medium hover:underline"
                      >
                        Bill →
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )
        ) : null}

        {tab === "orders" ? (
          board.orders.length === 0 ? (
            <p className="text-charcoal-500 py-16 text-center">No open orders right now.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {board.orders.map((o) => (
                <li key={o.id} className="border-ivory-200 shadow-card rounded-lg border bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`${base}/orders/${o.id}`}
                      className="text-forest-700 font-mono font-semibold hover:underline"
                    >
                      #{o.reference}
                    </Link>
                    <span className="text-sm">Table {o.tableLabel ?? "—"}</span>
                    <span className="ml-auto flex gap-1.5">
                      <OrderStatusBadge status={o.status} />
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </span>
                  </div>
                  <p className="text-charcoal-500 mt-1 text-xs">
                    {elapsed(o.placedAt, now)} ago{o.totalMinor != null ? ` · ${money(o.totalMinor)}` : ""}
                  </p>
                  <ItemList items={o.items} />
                  {o.customerNote ? <p className="text-info-700 mt-1 text-sm">Note: {o.customerNote}</p> : null}
                </li>
              ))}
            </ul>
          )
        ) : null}
      </main>
    </div>
  );
}

function ItemList({ items }: { items: FloorBoard["orders"][number]["items"] }) {
  return (
    <ul className="mt-2 text-sm">
      {items.map((i) => (
        <li key={i.id}>
          <span className="tabular font-semibold">{i.quantity}×</span> {i.name}
          {i.variant ? ` · ${i.variant}` : ""}
          {i.modifiers.length ? <span className="text-charcoal-500"> ({i.modifiers.join(", ")})</span> : null}
          {i.allergens ? (
            <span className="text-danger-700 ml-1 text-xs font-semibold">Allergens: {i.allergens}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
