import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { requireTenantPage } from "@/server/session";
import { getTicketForPrint } from "@/server/services/printing";

export const metadata: Metadata = { title: "Kitchen ticket" };

/**
 * Browser-printable kitchen ticket, laid out for thermal paper (58/80 mm) or A4.
 * ?w=58|80|210 overrides the width; otherwise the branch's first printer decides.
 */
export default async function TicketPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; ticketId: string }>;
  searchParams: Promise<{ w?: string; auto?: string }>;
}) {
  const { tenant: slug, ticketId } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const t = await getTicketForPrint(ctx, ticketId).catch((e) => {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  });
  const printer = await db.printerConfiguration.findFirst({
    where: { tenantId: ctx.tenant.id, branchId: t.branchId, isActive: true },
    orderBy: { createdAt: "asc" },
  });
  const width = [58, 80, 210].includes(Number(sp.w)) ? Number(sp.w) : (printer?.paperWidthMm ?? 80);
  const thermal = width < 100;

  return (
    <main className="bg-ivory-100 p-4 print:bg-white print:p-0">
      <style>{`@page { size: ${thermal ? `${width}mm auto` : "A4"}; margin: ${thermal ? "2mm" : "12mm"}; }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-md flex-wrap items-center justify-between gap-3">
        <p className="text-charcoal-600 text-sm">
          Paper: {thermal ? `${width} mm thermal` : "A4"}. In the print dialog choose your kitchen printer, set margins
          to none and turn off headers/footers.
        </p>
        <PrintButton label="Print ticket" auto={sp.auto === "1"} />
      </div>
      <article
        className="shadow-card mx-auto bg-white font-mono text-black print:shadow-none"
        style={{
          width: thermal ? `${width - 4}mm` : "100%",
          maxWidth: thermal ? undefined : "180mm",
          padding: thermal ? "2mm" : "6mm",
          fontSize: width <= 58 ? "11px" : "13px",
          lineHeight: 1.35,
        }}
      >
        <p className="text-center font-bold uppercase">{t.restaurantName}</p>
        <p className="text-center">
          {t.stationName} · {t.branchName}
        </p>
        <hr className="my-1.5 border-dashed border-black" />
        <div className="flex items-baseline justify-between">
          <span style={{ fontSize: "1.6em" }} className="font-bold">
            #{t.reference}
          </span>
          {t.tableLabel ? (
            <span style={{ fontSize: "1.4em" }} className="font-bold">
              T {t.tableLabel}
            </span>
          ) : null}
        </div>
        <p>{t.placedAt}</p>
        {t.customerName ? <p>Name: {t.customerName}</p> : null}
        <hr className="my-1.5 border-dashed border-black" />
        <ul>
          {t.items.map((i, idx) => (
            <li key={idx} className="mb-1.5">
              <p className="font-bold" style={{ fontSize: "1.2em" }}>
                {i.quantity} × {i.name}
                {i.variant ? ` (${i.variant})` : ""}
              </p>
              {i.modifiers.map((m) => (
                <p key={m} className="pl-3">
                  + {m}
                </p>
              ))}
              {i.note ? <p className="pl-3 font-bold">NOTE: {i.note}</p> : null}
              {i.allergens ? <p className="pl-3 font-bold">!! ALLERGY: {i.allergens}</p> : null}
            </li>
          ))}
        </ul>
        {t.customerNote ? (
          <>
            <hr className="my-1.5 border-dashed border-black" />
            <p className="font-bold">ORDER NOTE: {t.customerNote}</p>
          </>
        ) : null}
        <hr className="my-1.5 border-dashed border-black" />
      </article>
    </main>
  );
}
