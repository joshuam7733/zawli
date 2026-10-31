import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { platformRoleHasPermission } from "@/domain/permissions";
import { toMajorInput } from "@/domain/money";
import { db } from "@/server/db";
import { requirePlatformPage } from "@/server/session";
import { InvoiceForm } from "./invoice-form";

export const metadata: Metadata = { title: "New invoice" };

export default async function NewInvoicePage({ searchParams }: { searchParams: Promise<{ tenant?: string }> }) {
  const { tenant: tenantId } = await searchParams;
  const { user } = await requirePlatformPage("platform.tenants.view");
  if (!platformRoleHasPermission(user?.platformRole, "platform.billing.manage")) notFound();
  const tenant = tenantId
    ? await db.tenant.findUnique({ where: { id: tenantId }, include: { subscription: { include: { plan: true } } } })
    : null;
  if (!tenant) notFound();
  const plan = tenant.subscription?.plan;
  const currency = plan?.currency ?? tenant.currency;
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  const due = new Date(now.getTime() + 14 * 86_400_000);
  const month = start.toLocaleString("en", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/admin/tenants/${tenant.id}`} className="text-forest-700 hover:underline">
          ← {tenant.name}
        </Link>
      </p>
      <PageHeader
        title={`New invoice for ${tenant.name}`}
        description={`Amounts in ${currency}. Drafts are not visible to the restaurant until issued.`}
      />
      <InvoiceForm
        tenantId={tenant.id}
        currency={currency}
        defaults={{
          periodStart: start.toISOString().slice(0, 10),
          periodEnd: end.toISOString().slice(0, 10),
          dueDate: due.toISOString().slice(0, 10),
          line: plan
            ? { description: `${plan.name} plan — ${month}`, price: toMajorInput(plan.priceMinor, currency) }
            : { description: "", price: "" },
        }}
      />
    </>
  );
}
