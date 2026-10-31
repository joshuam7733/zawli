"use client";
import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ActionResult } from "@/server/action";
import { Button, Card, CardHeader, Field, Input, Notice, Textarea } from "@/components/ui";
import { createInvoiceAction } from "../../actions";

interface Line {
  key: number;
  description: string;
  quantity: string;
  price: string;
}

export function InvoiceForm({
  tenantId,
  currency,
  defaults,
}: {
  tenantId: string;
  currency: string;
  defaults: { periodStart: string; periodEnd: string; dueDate: string; line: { description: string; price: string } };
}) {
  const [state, action, pending] = useActionState<ActionResult, FormData>(createInvoiceAction, { ok: true });
  const [lines, setLines] = useState<Line[]>([
    { key: 0, description: defaults.line.description, quantity: "1", price: defaults.line.price },
  ]);
  return (
    <form action={action} className="grid max-w-4xl gap-6">
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="currency" value={currency} />
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      <Card>
        <CardHeader title="Billing period" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
          <Field label="From" htmlFor="periodStart">
            <Input id="periodStart" name="periodStart" type="date" required defaultValue={defaults.periodStart} />
          </Field>
          <Field label="To" htmlFor="periodEnd">
            <Input id="periodEnd" name="periodEnd" type="date" required defaultValue={defaults.periodEnd} />
          </Field>
          <Field label="Due date" htmlFor="dueDate">
            <Input id="dueDate" name="dueDate" type="date" required defaultValue={defaults.dueDate} />
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="Lines" />
        <div className="flex flex-col gap-2 px-5 py-5">
          {lines.map((l, i) => (
            <div key={l.key} className="grid grid-cols-[minmax(0,1fr)_5rem_9rem_2.5rem] items-end gap-2">
              <Field
                label={i === 0 ? "Description" : <span className="sr-only">Description</span>}
                htmlFor={`d-${l.key}`}
              >
                <Input
                  id={`d-${l.key}`}
                  name="lineDescription"
                  value={l.description}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, description: e.target.value } : x)))
                  }
                />
              </Field>
              <Field label={i === 0 ? "Qty" : <span className="sr-only">Quantity</span>} htmlFor={`q-${l.key}`}>
                <Input
                  id={`q-${l.key}`}
                  name="lineQuantity"
                  type="number"
                  min={1}
                  value={l.quantity}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, quantity: e.target.value } : x)))
                  }
                />
              </Field>
              <Field
                label={i === 0 ? `Unit (${currency})` : <span className="sr-only">Unit price</span>}
                htmlFor={`p-${l.key}`}
              >
                <Input
                  id={`p-${l.key}`}
                  name="linePrice"
                  inputMode="decimal"
                  className="tabular"
                  value={l.price}
                  onChange={(e) =>
                    setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, price: e.target.value } : x)))
                  }
                />
              </Field>
              <Button
                variant="ghost"
                size="sm"
                className="mb-1"
                aria-label="Remove line"
                onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.key !== l.key) : ls))}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLines((ls) => [...ls, { key: Date.now(), description: "", quantity: "1", price: "" }])}
            >
              <Plus className="size-4" aria-hidden /> Add line
            </Button>
          </div>
          <Field
            label={`Tax amount (${currency})`}
            htmlFor="tax"
            hint="Only if you are required to charge tax on your service. Leave empty otherwise."
            className="mt-3 max-w-56"
          >
            <Input id="tax" name="tax" inputMode="decimal" />
          </Field>
          <Field label="Notes / payment instructions" htmlFor="notes">
            <Textarea
              id="notes"
              name="notes"
              maxLength={500}
              rows={3}
              placeholder="e.g. Pay by mobile money to … quoting the invoice number."
            />
          </Field>
        </div>
      </Card>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" name="intent" value="issue" disabled={pending}>
          {pending ? "Saving…" : "Create and issue"}
        </Button>
        <Button type="submit" name="intent" value="draft" variant="secondary" disabled={pending}>
          Save as draft
        </Button>
      </div>
    </form>
  );
}
