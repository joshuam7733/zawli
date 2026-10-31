import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InvoiceDocument } from "@/components/invoice-document";
import { PrintButton } from "@/components/print-button";
import { isAppError } from "@/server/errors";
import { requireTenantPage } from "@/server/session";
import { getTenantInvoice } from "@/server/services/billing";

export const metadata: Metadata = { title: "Invoice" };

export default async function TenantInvoicePrint({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant: slug, id } = await params;
  const ctx = await requireTenantPage(slug);
  const inv = await getTenantInvoice(ctx, id).catch((e) => {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  });
  return (
    <main className="bg-ivory-100 min-h-dvh p-6 print:bg-white print:p-0">
      <style>{`@page { size: A4; margin: 15mm; }`}</style>
      <div className="no-print mx-auto mb-4 flex max-w-[190mm] justify-end">
        <PrintButton label="Print or save as PDF" />
      </div>
      <InvoiceDocument inv={inv} />
    </main>
  );
}
