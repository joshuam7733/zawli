import { Wordmark } from "./brand";
import { formatDate, formatMoney, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { BRAND } from "@/lib/brand";

interface InvoiceDoc {
  number: string;
  status: string;
  overdue: boolean;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  issueDate: Date | null;
  dueDate: Date;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountPaidMinor: number;
  notes: string | null;
  tenant: {
    name: string;
    legalName: string | null;
    addressLine: string | null;
    city: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    timezone: string;
    locale: string;
  };
  lines: { id: string; description: string; quantity: number; unitPriceMinor: number; amountMinor: number }[];
  payments: { id: string; amountMinor: number; method: string; reference: string | null; receivedAt: Date }[];
}

/** Printable A4 invoice used by both the platform and the restaurant view. */
export function InvoiceDocument({ inv }: { inv: InvoiceDoc }) {
  const loc = inv.tenant.locale;
  const tz = inv.tenant.timezone;
  const money = (m: number) => formatMoney(m, inv.currency, loc);
  return (
    <article className="text-charcoal-900 shadow-card mx-auto max-w-[190mm] bg-white p-10 text-sm print:p-0 print:shadow-none">
      <header className="flex items-start justify-between">
        <div>
          <Wordmark className="text-3xl" />
          <p className="text-charcoal-500 mt-2 text-xs">
            {BRAND.name} restaurant software · {BRAND.supportEmail}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-semibold">Invoice</p>
          <p className="font-mono">{inv.number}</p>
          <p className="mt-1 text-xs font-semibold uppercase">
            {inv.status === "VOID"
              ? "Void"
              : inv.status === "PAID"
                ? "Paid"
                : inv.overdue
                  ? "Overdue"
                  : inv.status === "DRAFT"
                    ? "Draft"
                    : "Due"}
          </p>
        </div>
      </header>
      <section className="mt-10 grid grid-cols-2 gap-8">
        <div>
          <p className="text-charcoal-500 text-xs font-semibold uppercase">Billed to</p>
          <p className="mt-1 font-semibold">{inv.tenant.legalName ?? inv.tenant.name}</p>
          {inv.tenant.addressLine ? <p>{inv.tenant.addressLine}</p> : null}
          {inv.tenant.city ? <p>{inv.tenant.city}</p> : null}
          {inv.tenant.contactEmail ? <p>{inv.tenant.contactEmail}</p> : null}
          {inv.tenant.contactPhone ? <p>{inv.tenant.contactPhone}</p> : null}
        </div>
        <dl className="grid grid-cols-2 gap-y-1 text-right">
          <dt className="text-charcoal-500">Issued</dt>
          <dd>{inv.issueDate ? formatDate(inv.issueDate, tz, loc) : "—"}</dd>
          <dt className="text-charcoal-500">Due</dt>
          <dd className="font-semibold">{formatDate(inv.dueDate, tz, loc)}</dd>
          <dt className="text-charcoal-500">Period</dt>
          <dd>
            {formatDate(inv.periodStart, tz, loc)} – {formatDate(inv.periodEnd, tz, loc)}
          </dd>
        </dl>
      </section>
      <table className="mt-10 w-full">
        <thead>
          <tr className="border-charcoal-900 border-b-2 text-left text-xs uppercase">
            <th className="py-2">Description</th>
            <th className="py-2 text-right">Qty</th>
            <th className="py-2 text-right">Unit price</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l) => (
            <tr key={l.id} className="border-ivory-200 border-b">
              <td className="py-2">{l.description}</td>
              <td className="tabular py-2 text-right">{l.quantity}</td>
              <td className="tabular py-2 text-right">{money(l.unitPriceMinor)}</td>
              <td className="tabular py-2 text-right">{money(l.amountMinor)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-4 ml-auto w-64 space-y-1">
        <div className="flex justify-between">
          <dt>Subtotal</dt>
          <dd className="tabular">{money(inv.subtotalMinor)}</dd>
        </div>
        {inv.taxMinor ? (
          <div className="flex justify-between">
            <dt>Tax</dt>
            <dd className="tabular">{money(inv.taxMinor)}</dd>
          </div>
        ) : null}
        <div className="border-charcoal-900 flex justify-between border-t pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd className="tabular">{money(inv.totalMinor)}</dd>
        </div>
        <div className="flex justify-between">
          <dt>Paid</dt>
          <dd className="tabular">{money(inv.amountPaidMinor)}</dd>
        </div>
        <div className="flex justify-between font-semibold">
          <dt>Balance</dt>
          <dd className="tabular">{money(inv.status === "VOID" ? 0 : inv.totalMinor - inv.amountPaidMinor)}</dd>
        </div>
      </dl>
      {inv.payments.length ? (
        <section className="mt-8">
          <p className="text-charcoal-500 text-xs font-semibold uppercase">Payments received</p>
          <ul className="mt-1">
            {inv.payments.map((p) => (
              <li key={p.id}>
                {formatDate(p.receivedAt, tz, loc)} · {money(p.amountMinor)} · {PAYMENT_METHOD_LABEL[p.method]}
                {p.reference ? ` · ref ${p.reference}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {inv.notes ? <p className="text-charcoal-700 mt-8 whitespace-pre-line">{inv.notes}</p> : null}
    </article>
  );
}
