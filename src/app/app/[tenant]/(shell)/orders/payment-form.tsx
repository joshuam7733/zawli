"use client";
import { useActionState, useEffect, useRef, useState } from "react";
import type { ActionResult } from "@/server/action";
import { Button, Field, Input, Notice, Select } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { parseMoneyInput, toMajorInput } from "@/domain/money";

type Action = (p: ActionResult, fd: FormData) => Promise<ActionResult<{ changeMinor: number }>>;

const METHODS = [
  ["CASH", "Cash"],
  ["MOBILE_MONEY", "Mobile money (paid at the restaurant)"],
  ["CARD", "Card / POS"],
  ["OTHER", "Other"],
] as const;

/**
 * Records money received at the restaurant. Partial payments are allowed; the
 * amount can't exceed what is due. For cash, enter what the guest handed over to
 * see the change — only the applied amount is recorded.
 */
export function PaymentForm({
  action,
  hidden,
  dueMinor,
  currency,
  locale,
  fixedAmount,
  submitLabel = "Record payment",
}: {
  action: Action;
  hidden: Record<string, string>;
  dueMinor: number;
  currency: string;
  locale: string;
  fixedAmount?: boolean;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{ changeMinor: number }>);
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState(toMajorInput(dueMinor, currency));
  const [tendered, setTendered] = useState("");
  // When the balance changes (a payment was recorded), prefill the new balance.
  const [prevDue, setPrevDue] = useState(dueMinor);
  if (prevDue !== dueMinor) {
    setPrevDue(dueMinor);
    setAmount(toMajorInput(dueMinor, currency));
    setTendered("");
  }
  // One idempotency key per intended payment: a double-click or a retry after a
  // network error reuses it; it is replaced only after a confirmed success.
  const keyRef = useRef<string | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const money = (m: number) => formatMoney(m, currency, locale);

  useEffect(() => {
    if (state.ok && state.data) keyRef.current = null;
  }, [state]);

  const amountMinor = fixedAmount ? dueMinor : parseMoneyInput(amount, currency);
  const tenderedMinor = tendered ? parseMoneyInput(tendered, currency) : null;
  const change =
    amountMinor != null && tenderedMinor != null && tenderedMinor >= amountMinor ? tenderedMinor - amountMinor : null;

  const lastResult =
    state.ok && state.data ? (
      <Notice tone="forest">
        <span className="text-base font-semibold">
          {state.message ?? "Payment recorded"}
          {state.data.changeMinor > 0 ? ` — give ${money(state.data.changeMinor)} change.` : "."}
        </span>
      </Notice>
    ) : null;

  // Fully paid: keep showing the last result (the cashier needs the change amount).
  if (dueMinor <= 0) {
    return (
      <div className="flex flex-col gap-3">
        {lastResult}
        <p className="text-forest-700 text-sm font-medium">Fully paid.</p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      onSubmit={() => {
        keyRef.current ??= crypto.randomUUID();
        if (keyInput.current) keyInput.current.value = keyRef.current;
      }}
      className="flex flex-col gap-4"
    >
      {Object.entries(hidden).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <input ref={keyInput} type="hidden" name="idempotencyKey" defaultValue="" />
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      {lastResult}
      <div className="grid gap-4 sm:grid-cols-2">
        {!fixedAmount ? (
          <Field
            label={`Amount received (${currency})`}
            htmlFor="amount"
            hint={`Due: ${money(dueMinor)}. Enter less to record a partial payment.`}
          >
            <Input
              id="amount"
              name="amount"
              inputMode="decimal"
              className="tabular"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </Field>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Amount due</span>
            <span className="tabular text-2xl font-semibold">{money(dueMinor)}</span>
          </div>
        )}
        <Field label="Method" htmlFor="method">
          <Select id="method" name="method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {METHODS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        {method === "CASH" ? (
          <Field
            label={`Cash handed over (${currency})`}
            htmlFor="tendered"
            hint={change != null ? `Change to give: ${money(change)}` : "Optional — to work out change."}
          >
            <Input
              id="tendered"
              name="tendered"
              inputMode="decimal"
              className="tabular"
              value={tendered}
              onChange={(e) => setTendered(e.target.value)}
            />
          </Field>
        ) : (
          <Field
            label="Reference"
            htmlFor="reference"
            hint={
              method === "MOBILE_MONEY"
                ? "Transaction ID from the customer's SMS. Not verified automatically."
                : "Slip or approval number, if any."
            }
          >
            <Input id="reference" name="reference" maxLength={80} />
          </Field>
        )}
      </div>
      <div>
        <Button type="submit" variant="accent" size="lg" disabled={pending || dueMinor <= 0}>
          {pending ? "Recording…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
