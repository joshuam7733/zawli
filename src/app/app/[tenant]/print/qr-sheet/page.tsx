import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { PrintButton } from "@/components/print-button";
import { branchesWith } from "@/server/authz";
import { qrSvg } from "@/server/qr";
import { requireTenantPage } from "@/server/session";
import { getQrSheet } from "@/server/services/tables";

export const metadata: Metadata = { title: "QR code sheet" };

/** A4 sheet with one card per table (2 × 3 per page). */
export default async function QrSheetPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const { branch: branchParam } = await searchParams;
  const ctx = await requireTenantPage(slug);
  const allowed = branchesWith(ctx, "tables.manage");
  const branchId = branchParam && allowed.includes(branchParam) ? branchParam : allowed[0];
  if (!branchId) notFound();
  const { branch, tables } = await getQrSheet(ctx, branchId);
  const cards = await Promise.all(tables.map(async (t) => ({ ...t, svg: await qrSvg(t.url) })));

  return (
    <main className="mx-auto max-w-[210mm] bg-white p-6 print:p-0">
      <style>{`@page { size: A4; margin: 10mm; } .qr-card { break-inside: avoid; }`}</style>
      <div className="no-print mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">
            {ctx.tenant.name} · {branch.name}
          </h1>
          <p className="text-charcoal-600 text-sm">{cards.length} table QR codes. Laminate them or use table stands.</p>
        </div>
        <PrintButton label="Print sheet" />
      </div>
      <div className="grid grid-cols-2 gap-[6mm]">
        {cards.map((t) => (
          <div
            key={t.id}
            className="qr-card border-forest-800 flex flex-col items-center rounded-lg border-2 px-4 py-5 text-center"
          >
            <p className="text-forest-800 text-sm font-semibold tracking-wider uppercase">{ctx.tenant.name}</p>
            <p className="font-display mt-1 text-3xl font-bold">Table {t.label}</p>
            <div
              className="mt-3 w-[55mm] [&_svg]:h-auto [&_svg]:w-full"
              dangerouslySetInnerHTML={{ __html: t.svg }}
              role="img"
              aria-label={`QR code for table ${t.label}`}
            />
            <p className="mt-3 text-sm font-medium">Scan to see the menu and order</p>
            <p className="text-charcoal-500 text-xs">No app needed · Pay at the table</p>
            <div className="mt-3 text-xs">
              <Wordmark className="text-sm" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
