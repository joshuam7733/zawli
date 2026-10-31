"use client";
import { useEffect, useState } from "react";
import { Loader2, Smartphone } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

type Provider = "MTN_MOMO" | "AIRTEL_MONEY";
const LABEL: Record<Provider, string> = { MTN_MOMO: "MTN MoMo", AIRTEL_MONEY: "Airtel Money" };
const PIN_HINT: Record<Provider, string> = {
  MTN_MOMO: "Enter your MTN MoMo PIN on the prompt to approve.",
  AIRTEL_MONEY: "Enter your Airtel Money PIN on the prompt to approve.",
};
const PHONE_KEY = "zawli-mobile-money-phone";

export interface PayPanelOrder {
  totalMinor: number;
  currency: string;
  paymentDueBy: string | null;
  mobileMoneyProviders: Provider[];
  payment: {
    provider: Provider;
    status: string;
    maskedPhone: string;
    failureReason: string | null;
    simulated: boolean;
  } | null;
  restaurant: { locale: string };
}

function useCountdown(until: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);
  if (!until) return null;
  const s = Math.max(0, Math.floor((new Date(until).getTime() - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Pay-first: the guest pays by MTN MoMo or Airtel Money before the kitchen gets the order. */
export function PayPanel({
  order,
  publicToken,
  onChanged,
}: {
  order: PayPanelOrder;
  publicToken: string;
  onChanged: () => void;
}) {
  const providers = order.mobileMoneyProviders;
  const [provider, setProvider] = useState<Provider>(order.payment?.provider ?? providers[0] ?? "MTN_MOMO");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = useCountdown(order.paymentDueBy);
  const money = formatMoney(order.totalMinor, order.currency, order.restaurant.locale);
  const pending = order.payment?.status === "PENDING";
  const lastFailed =
    order.payment && ["FAILED", "EXPIRED"].includes(order.payment.status) ? order.payment.failureReason : null;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PHONE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill from browser storage after hydration
      if (saved) setPhone(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  async function pay(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      localStorage.setItem(PHONE_KEY, phone);
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch(`/api/public/orders/${publicToken}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, phone }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) setError(body?.error?.message ?? "The payment couldn't be started. Please try again.");
      else if (body?.status === "FAILED") setError(body.message);
      onChanged();
    } catch {
      setError("No connection. Check your signal and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (providers.length === 0) {
    return (
      <div className="border-ivory-200 shadow-card mt-5 rounded-lg border bg-white p-5 text-sm">
        Mobile money payments aren&apos;t available right now. Please ask a member of staff.
      </div>
    );
  }

  return (
    <section
      aria-labelledby="pay-title"
      className="border-forest-600/30 shadow-card mt-5 rounded-lg border-2 bg-white p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 id="pay-title" className="font-display text-xl font-semibold">
          Pay {money} to send your order to the kitchen
        </h2>
        {left ? (
          <span
            className="tabular bg-ivory-100 text-charcoal-700 shrink-0 rounded px-2 py-1 text-sm"
            aria-label={`Time left to pay: ${left}`}
          >
            {left}
          </span>
        ) : null}
      </div>
      <p className="text-charcoal-600 mt-1 text-sm">
        The kitchen starts as soon as your payment is confirmed. Unpaid orders are cancelled when the timer runs out.
      </p>

      {pending && order.payment ? (
        <div role="status" className="bg-forest-50 mt-4 flex items-start gap-3 rounded-md p-4">
          <Loader2 className="text-forest-700 mt-0.5 size-5 shrink-0 animate-spin" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">Check your phone ({order.payment.maskedPhone})</p>
            <p className="mt-0.5">{PIN_HINT[order.payment.provider]}</p>
            <p className="text-charcoal-500 mt-1 text-xs">
              No prompt yet? It can take up to a minute. This page updates by itself.
            </p>
            {order.payment.simulated ? (
              <p className="text-charcoal-500 mt-1 text-xs">Test mode — no real money moves.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <form onSubmit={pay} className="mt-4 flex flex-col gap-4">
          {error || lastFailed ? (
            <p
              role="alert"
              className="bg-danger-50 text-danger-700 ring-danger-600/20 rounded-md px-3 py-2 text-sm ring-1"
            >
              {error ?? lastFailed}
            </p>
          ) : null}
          {providers.length > 1 ? (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Pay with</legend>
              <div className="grid grid-cols-2 gap-2">
                {providers.map((p) => (
                  <label
                    key={p}
                    className={cn(
                      "flex h-12 cursor-pointer items-center justify-center rounded-md border-2 text-sm font-semibold",
                      provider === p
                        ? "border-forest-700 bg-forest-50 text-forest-800"
                        : "border-ivory-300 text-charcoal-700",
                    )}
                  >
                    <input
                      type="radio"
                      name="provider"
                      value={p}
                      checked={provider === p}
                      onChange={() => setProvider(p)}
                      className="sr-only"
                    />
                    {LABEL[p]}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm font-semibold">Pay with {LABEL[providers[0]]}</p>
          )}
          <label className="block">
            <span className="text-sm font-semibold">{LABEL[provider]} number</span>
            <div className="mt-1.5 flex items-center gap-2">
              <Smartphone className="text-charcoal-400 size-5" aria-hidden />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                inputMode="tel"
                autoComplete="tel"
                required
                placeholder={provider === "MTN_MOMO" ? "0772 123456" : "0752 123456"}
                className="border-ivory-300 focus:border-forest-600 focus:ring-forest-600/20 h-12 w-full rounded-md border bg-white px-3 text-base focus:ring-2 focus:outline-none"
              />
            </div>
          </label>
          <button
            type="submit"
            disabled={busy}
            className="text-charcoal-950 flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-lime-400 text-base font-semibold hover:bg-lime-300 disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-5 animate-spin" aria-hidden /> : null}
            {busy ? "Sending payment request…" : `Pay ${money} with ${LABEL[provider]}`}
          </button>
        </form>
      )}
    </section>
  );
}
