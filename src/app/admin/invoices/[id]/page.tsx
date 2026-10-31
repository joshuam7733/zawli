import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { InvoiceDocument } from "@/components/invoice-document";
import { PrintButton } from "@/components/print-button";
import { Card, CardHeader, Field, Input, Select } from "@/components/ui";
import { InvoiceBadge } from "@/components/status";
import { platformRoleHasPermission } from "@/domain/permissions";
import { toMajorInput } from "@/domain/money";
import { isAppError } from "@/server/errors";
import { requirePlatformPage } from "@/server/session";
import { getInvoice } from "@/server/services/billing";
import { issueInvoiceAction, recordInvoicePaymentAction, voidInvoiceAction } from "../../actions";

export const metadata: Metadata = { title: "Invoice" };
export const dynamic = "force-dynamic";

export default async function AdminInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user } = await requirePlatformPage("platform.tenants.view");
  const inv = await getInvoice(user, id).catch((e) => {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) notFound();
    throw e;
  });
  const canBill = platformRoleHasPermission(user?.platformRole, "platform.billing.manage");
  const open = inv.status === "ISSUED" || inv.status === "PARTIALLY_PAID";
  return (
    <>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/admin/tenants/${inv.tenantId}`} className="text-forest-700 text-sm hover:underline">
          ← {inv.tenant.name}
        </Link>
        <InvoiceBadge status={inv.status} overdue={inv.overdue} />
        <span className="ml-auto flex flex-wrap gap-2">
          {canBill && inv.status === "DRAFT" ? (
            <ActionButton action={issueInvoiceAction} fields={{ invoiceId: inv.id }} variant="primary" size="md">
              Issue invoice
            </ActionButton>
          ) : null}
          <PrintButton label="Print / PDF" />
        </span>
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,1.3fr)]">
        <InvoiceDocument inv={inv} />
        {canBill ? (
          <div className="no-print flex flex-col gap-6">
            {open ? (
              <Card>
                <CardHeader title="Record a payment" description="Money received from the restaurant (manual)." />
                <div className="px-5 py-5">
                  <ActionForm action={recordInvoicePaymentAction} submitLabel="Record payment">
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <input type="hidden" name="currency" value={inv.currency} />
                    <Field label={`Amount (${inv.currency})`} htmlFor="amount">
                      <Input
                        id="amount"
                        name="amount"
                        required
                        inputMode="decimal"
                        defaultValue={toMajorInput(inv.totalMinor - inv.amountPaidMinor, inv.currency)}
                      />
                    </Field>
                    <Field label="Method" htmlFor="method">
                      <Select id="method" name="method" defaultValue="MOBILE_MONEY">
                        <option value="MOBILE_MONEY">Mobile money</option>
                        <option value="CASH">Cash</option>
                        <option value="CARD">Card</option>
                        <option value="OTHER">Bank transfer / other</option>
                      </Select>
                    </Field>
                    <Field label="Reference" htmlFor="reference">
                      <Input id="reference" name="reference" maxLength={80} />
                    </Field>
                    <Field label="Received on" htmlFor="receivedAt">
                      <Input
                        id="receivedAt"
                        name="receivedAt"
                        type="date"
                        required
                        defaultValue={new Date().toISOString().slice(0, 10)}
                      />
                    </Field>
                  </ActionForm>
                </div>
              </Card>
            ) : null}
            {(inv.status === "DRAFT" || inv.status === "ISSUED") && inv.amountPaidMinor === 0 ? (
              <Card>
                <CardHeader title="Void invoice" description="For mistakes. The number is kept, nothing is deleted." />
                <div className="px-5 py-5">
                  <ActionForm action={voidInvoiceAction} submitLabel="Void invoice" submitVariant="danger">
                    <input type="hidden" name="invoiceId" value={inv.id} />
                    <Field label="Reason" htmlFor="void-reason">
                      <Input id="void-reason" name="reason" required minLength={3} maxLength={300} />
                    </Field>
                  </ActionForm>
                </div>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
