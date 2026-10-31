"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import type { KitchenBoard } from "@/server/services/orders";
import { ConnectionPill } from "@/components/connection-pill";
import { postJson, useLiveBoard, useNow } from "@/components/use-live-board";
import { elapsed, elapsedMinutes, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

type Ticket = KitchenBoard["tickets"][number];

const NEXT: Record<string, { to: "ACKNOWLEDGED" | "PREPARING" | "READY"; label: string } | null> = {
  PLACED: { to: "ACKNOWLEDGED", label: "Acknowledge" },
  ACKNOWLEDGED: { to: "PREPARING", label: "Start preparing" },
  PREPARING: { to: "READY", label: "Mark ready" },
  READY: null,
  CANCELLED: null,
};

const STATE_STYLE: Record<string, { bar: string; label: string }> = {
  PLACED: { bar: "bg-warning-500 text-charcoal-950", label: "NEW" },
  ACKNOWLEDGED: { bar: "bg-info-700 text-white", label: "ACKNOWLEDGED" },
  PREPARING: { bar: "bg-forest-600 text-white", label: "PREPARING" },
  READY: { bar: "bg-lime-400 text-charcoal-950", label: "READY" },
};

export function KitchenScreen({
  tenantSlug,
  tenantName,
  timezone,
  locale,
  branches,
  initial,
  initialStation,
}: {
  tenantSlug: string;
  tenantName: string;
  timezone: string;
  locale: string;
  branches: { id: string; name: string }[];
  initial: KitchenBoard;
  initialStation: string | null;
}) {
  const router = useRouter();
  const [station, setStation] = useState<string | null>(initialStation);
  const [showReady, setShowReady] = useState(true);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const branchId = initial.branch.id;
  const boardUrl = `/api/app/${tenantSlug}/kitchen?branch=${branchId}${station ? `&station=${station}` : ""}`;
  const { board, setBoard, refetch, connection } = useLiveBoard(
    boardUrl,
    `/api/app/${tenantSlug}/events?branch=${branchId}`,
    initial,
  );
  const now = useNow(15_000);

  const tickets = useMemo(
    () => board.tickets.filter((t) => showReady || t.status !== "READY"),
    [board.tickets, showReady],
  );
  const counts = useMemo(() => {
    const c = { PLACED: 0, ACKNOWLEDGED: 0, PREPARING: 0, READY: 0 } as Record<string, number>;
    for (const t of board.tickets) c[t.status] = (c[t.status] ?? 0) + 1;
    return c;
  }, [board.tickets]);
  const printable = board.branch.fulfillmentMode !== "DIGITAL_DISPLAY";

  async function advance(t: Ticket) {
    const next = NEXT[t.status];
    if (!next || pending.has(t.id)) return;
    setPending((p) => new Set(p).add(t.id));
    setError(null);
    // Optimistic: move the card now; the server response/refetch confirms it.
    setBoard((b) => ({ ...b, tickets: b.tickets.map((x) => (x.id === t.id ? { ...x, status: next.to } : x)) }));
    const err = await postJson(`/api/app/${tenantSlug}/tickets/${t.id}`, { to: next.to });
    if (err) setError(`Order #${t.order.reference}: ${err}`);
    await refetch();
    setPending((p) => {
      const n = new Set(p);
      n.delete(t.id);
      return n;
    });
  }

  return (
    <div className="bg-charcoal-950 text-ivory-50 min-h-dvh">
      <header className="bg-charcoal-950/95 sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-white/10 px-4 py-3 backdrop-blur">
        <Link
          href={`/app/${tenantSlug}/orders`}
          className="text-ivory-200 rounded-md p-2 hover:bg-white/10"
          aria-label="Back to orders"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-lg font-semibold">Kitchen · {board.branch.name}</h1>
          <p className="text-ivory-200/60 text-xs">{tenantName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Count label="New" n={counts.PLACED} tone="bg-warning-500 text-charcoal-950" />
          <Count label="Acknowledged" n={counts.ACKNOWLEDGED} tone="bg-info-700" />
          <Count label="Preparing" n={counts.PREPARING} tone="bg-forest-600" />
          <Count label="Ready" n={counts.READY} tone="bg-lime-400 text-charcoal-950" />
        </div>
        <ConnectionPill connection={connection} dark />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2.5">
        {branches.length > 1 ? (
          <select
            aria-label="Branch"
            value={branchId}
            onChange={(e) => router.push(`/app/${tenantSlug}/kitchen?branch=${e.target.value}`)}
            className="bg-charcoal-900 h-9 rounded-md border border-white/15 px-2 text-sm"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        ) : null}
        {board.stations.length > 1 ? (
          <div role="group" aria-label="Station" className="flex flex-wrap gap-1">
            {[{ id: null as string | null, name: "All stations" }, ...board.stations].map((s) => (
              <button
                key={s.id ?? "all"}
                onClick={() => setStation(s.id)}
                aria-pressed={station === s.id}
                className={cn(
                  "h-9 rounded-md px-3 text-sm font-medium",
                  station === s.id ? "bg-ivory-50 text-charcoal-950" : "text-ivory-200 bg-white/5 hover:bg-white/10",
                )}
              >
                {s.name}
              </button>
            ))}
          </div>
        ) : null}
        <label className="text-ivory-200 ml-auto flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showReady}
            onChange={(e) => setShowReady(e.target.checked)}
            className="size-4 accent-lime-400"
          />
          Show ready (last 30 min)
        </label>
      </div>

      {!board.canProgress ? (
        <p className="text-ivory-200 mx-4 mt-3 rounded-md bg-white/5 px-3 py-2 text-sm">
          View only — your role can&apos;t change ticket status at this branch.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="bg-danger-600 mx-4 mt-3 rounded-md px-3 py-2 text-sm font-medium text-white">
          {error}
        </p>
      ) : null}

      {tickets.length === 0 ? (
        <div className="grid min-h-[60dvh] place-items-center text-center">
          <div>
            <p className="text-2xl font-semibold">No open tickets</p>
            <p className="text-ivory-200/60 mt-1">New orders appear here automatically.</p>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3 p-4">
          {tickets.map((t) => {
            const mins = elapsedMinutes(t.createdAt, now);
            const late = t.status !== "READY" && mins >= board.delayMinutes;
            const style = STATE_STYLE[t.status];
            const next = NEXT[t.status];
            return (
              <li
                key={t.id}
                className={cn(
                  "text-charcoal-950 flex flex-col overflow-hidden rounded-lg bg-white",
                  late ? "ring-danger-600 ring-4" : "ring-1 ring-white/10",
                  t.status === "READY" && "opacity-75",
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between px-3 py-1.5 text-xs font-bold tracking-wider",
                    style.bar,
                  )}
                >
                  <span>{style.label}</span>
                  {late ? (
                    <span className="bg-danger-600 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-white">
                      <AlertTriangle className="size-3.5" aria-hidden /> LATE
                    </span>
                  ) : null}
                </div>
                <div className="flex items-start justify-between gap-2 px-4 pt-3">
                  <div>
                    <p className="font-mono text-2xl font-bold">#{t.order.reference}</p>
                    <p className="text-charcoal-600 text-sm">
                      {t.order.tableLabel ? (
                        <>
                          Table <strong className="text-charcoal-950 text-lg">{t.order.tableLabel}</strong>
                        </>
                      ) : (
                        "No table"
                      )}
                      {t.order.customerName ? ` · ${t.order.customerName}` : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className={cn("tabular text-lg font-semibold", late ? "text-danger-700" : "text-charcoal-800")}>
                      {elapsed(t.createdAt, now)}
                    </p>
                    <p className="text-charcoal-500 text-xs">{formatTime(t.createdAt, timezone, locale)}</p>
                    {board.stations.length > 1 ? (
                      <p className="text-charcoal-600 text-xs font-medium">{t.station.name}</p>
                    ) : null}
                  </div>
                </div>
                <ul className="divide-ivory-200 flex-1 divide-y px-4 py-2">
                  {t.items.map((i) => (
                    <li key={i.id} className="py-2">
                      <p className="text-lg leading-snug font-semibold">
                        <span className="tabular bg-charcoal-950 text-ivory-50 mr-2 inline-block min-w-7 rounded px-1.5 text-center">
                          {i.quantity}
                        </span>
                        {i.name}
                        {i.variant ? <span className="text-charcoal-600 font-normal"> · {i.variant}</span> : null}
                      </p>
                      {i.modifiers.length ? (
                        <ul className="text-charcoal-800 mt-0.5 ml-9 text-base">
                          {i.modifiers.map((m) => (
                            <li key={m.id}>+ {m.name}</li>
                          ))}
                        </ul>
                      ) : null}
                      {i.note ? (
                        <p className="bg-warning-50 text-warning-700 mt-1 ml-9 rounded px-2 py-1 text-sm font-medium">
                          Note: {i.note}
                        </p>
                      ) : null}
                      {i.allergens ? (
                        <p className="bg-danger-50 text-danger-700 mt-1 ml-9 inline-flex items-center gap-1 rounded px-2 py-1 text-sm font-bold">
                          <AlertTriangle className="size-4" aria-hidden /> Allergens: {i.allergens}
                        </p>
                      ) : null}
                      {i.prepNotes ? <p className="text-charcoal-500 mt-1 ml-9 text-xs">Prep: {i.prepNotes}</p> : null}
                    </li>
                  ))}
                </ul>
                {t.order.customerNote ? (
                  <p className="bg-info-50 text-info-700 mx-4 mb-2 rounded px-2 py-1.5 text-sm">
                    Order note: {t.order.customerNote}
                  </p>
                ) : null}
                <div className="border-ivory-200 flex gap-2 border-t p-3">
                  {next && board.canProgress ? (
                    <button
                      onClick={() => advance(t)}
                      disabled={pending.has(t.id)}
                      className={cn(
                        "h-14 flex-1 rounded-md text-base font-bold disabled:opacity-60",
                        next.to === "READY"
                          ? "text-charcoal-950 bg-lime-400 hover:bg-lime-300"
                          : "bg-forest-800 text-ivory-50 hover:bg-forest-700",
                      )}
                    >
                      {pending.has(t.id) ? "Saving…" : next.label}
                    </button>
                  ) : (
                    <p className="text-charcoal-500 flex h-14 flex-1 items-center justify-center text-sm font-medium">
                      {t.status === "READY" ? "Waiting for pickup" : "—"}
                    </p>
                  )}
                  {printable ? (
                    <a
                      href={`/app/${tenantSlug}/print/ticket/${t.id}`}
                      target="_blank"
                      rel="noopener"
                      className="border-ivory-300 text-charcoal-700 hover:bg-ivory-100 grid h-14 w-14 place-items-center rounded-md border"
                      aria-label={`Print ticket #${t.order.reference}`}
                    >
                      <Printer className="size-5" />
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Count({ label, n, tone }: { label: string; n: number; tone: string }) {
  return (
    <span className={cn("tabular inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 font-semibold", tone)}>
      {n} <span className="font-normal">{label}</span>
    </span>
  );
}
