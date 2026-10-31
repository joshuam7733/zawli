import { formatMoney } from "@/lib/format";

/** Accessible daily bar chart (HTML, no chart library). Values also exposed as a table for screen readers. */
export function DailyBars({
  data,
  currency,
  locale,
}: {
  data: { day: string; orders: number; valueMinor: number }[];
  currency: string;
  locale: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.valueMinor));
  const label = (day: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).format(
      new Date(`${day}T00:00:00Z`),
    );
  return (
    <figure>
      <div aria-hidden className="flex h-40 items-end gap-1">
        {data.map((d) => (
          <div
            key={d.day}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${label(d.day)}: ${formatMoney(d.valueMinor, currency, locale)} · ${d.orders} orders`}
          >
            <div
              className="bg-forest-600 group-hover:bg-forest-500 min-h-[2px] rounded-t-sm transition-colors"
              style={{ height: `${(d.valueMinor / max) * 100}%` }}
            />
          </div>
        ))}
      </div>
      <div aria-hidden className="text-charcoal-500 mt-2 flex justify-between text-[11px]">
        <span>{label(data[0].day)}</span>
        <span>{label(data[data.length - 1].day)}</span>
      </div>
      <table className="sr-only">
        <caption>Daily order value</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.day}>
              <th scope="row">{label(d.day)}</th>
              <td>{formatMoney(d.valueMinor, currency, locale)}</td>
              <td>{d.orders} orders</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
