import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, Printer } from "lucide-react";
import { ActionButton, ActionForm } from "@/components/action-form";
import { BranchTabs, pickBranch } from "@/components/branch-tabs";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { branchesWith } from "@/server/authz";
import { db } from "@/server/db";
import { qrSvg } from "@/server/qr";
import { requireTenantPage } from "@/server/session";
import { listTables, qrUrl } from "@/server/services/tables";
import { elapsed } from "@/lib/format";
import {
  closeSessionAction,
  createTableAction,
  regenerateQrAction,
  revokeQrAction,
  setTableActiveAction,
  updateTableAction,
} from "./actions";

export const metadata: Metadata = { title: "Tables & QR codes" };

export default async function TablesPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const allowed = branchesWith(ctx, "tables.manage");
  if (allowed.length === 0) notFound();
  const branches = await db.branch.findMany({
    where: { tenantId: ctx.tenant.id, id: { in: allowed } },
    orderBy: { createdAt: "asc" },
  });
  const branch = pickBranch(branches, sp.branch)!;
  const tables = await listTables(ctx, branch.id);
  const svgs = new Map(
    await Promise.all(tables.filter((t) => t.qr).map(async (t) => [t.id, await qrSvg(qrUrl(t.qr!.token))] as const)),
  );
  const base = `/app/${slug}/tables`;

  return (
    <>
      <PageHeader
        title="Tables & QR codes"
        description="Each table has its own QR code. Guests scan it to open your menu and order for that table."
        actions={
          tables.length > 0 ? (
            <ButtonLink href={`/app/${slug}/print/qr-sheet?branch=${branch.id}`} target="_blank" variant="secondary">
              <Printer className="size-4" aria-hidden /> Print all QR codes
            </ButtonLink>
          ) : null
        }
      />
      <BranchTabs branches={branches} current={branch.id} hrefFor={(id) => `${base}?branch=${id}`} />

      <Card className="mb-6">
        <CardHeader title={`Add a table${branches.length > 1 ? ` at ${branch.name}` : ""}`} />
        <div className="px-5 py-4">
          <ActionForm action={createTableAction.bind(null, slug)} submitLabel="Add table" resetOnSuccess>
            <input type="hidden" name="branchId" value={branch.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Label" htmlFor="label" hint="Number or name printed on the table">
                <Input id="label" name="label" required maxLength={20} placeholder="e.g. 12 or Patio 3" />
              </Field>
              <Field label="Area" htmlFor="area" hint="Optional">
                <Input id="area" name="area" maxLength={40} placeholder="e.g. Terrace" />
              </Field>
              <Field label="Seats" htmlFor="seats" hint="Optional">
                <Input id="seats" name="seats" type="number" min={1} max={100} />
              </Field>
            </div>
          </ActionForm>
        </div>
      </Card>

      {tables.length === 0 ? (
        <Card>
          <EmptyState
            title="No tables yet"
            description="Add your first table above. A QR code is created for it automatically."
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {tables.map((t) => (
            <li key={t.id}>
              <Card className={t.isActive ? "h-full" : "h-full opacity-70"}>
                <div className="flex gap-4 p-4">
                  <div className="border-ivory-200 size-28 shrink-0 rounded-md border bg-white p-1">
                    {svgs.get(t.id) ? (
                      <div
                        className="size-full [&_svg]:size-full"
                        dangerouslySetInnerHTML={{ __html: svgs.get(t.id)! }}
                        role="img"
                        aria-label={`QR code for table ${t.label}`}
                      />
                    ) : (
                      <div className="text-charcoal-500 grid size-full place-items-center text-center text-xs">
                        No active QR code
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-xl font-semibold">Table {t.label}</p>
                    <p className="text-charcoal-500 text-sm">
                      {[t.area, t.seats ? `${t.seats} seats` : null].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {!t.isActive ? <Badge>Inactive</Badge> : null}
                      {t.openSession ? (
                        <Badge tone="lime">Occupied · {elapsed(t.openSession.openedAt)}</Badge>
                      ) : t.isActive ? (
                        <Badge tone="forest">Free</Badge>
                      ) : null}
                      <Badge>{t._count.orders} orders</Badge>
                    </div>
                    {t.qr ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-sm">
                        <a
                          href={`/api/app/${slug}/tables/${t.id}/qr?format=png`}
                          className="text-forest-700 inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          <Download className="size-3.5" aria-hidden /> PNG
                        </a>
                        <a
                          href={`/api/app/${slug}/tables/${t.id}/qr?format=svg`}
                          className="text-forest-700 inline-flex items-center gap-1 font-medium hover:underline"
                        >
                          <Download className="size-3.5" aria-hidden /> SVG
                        </a>
                        <a
                          href={`/t/${t.qr.token}`}
                          target="_blank"
                          rel="noopener"
                          className="text-forest-700 font-medium hover:underline"
                        >
                          Open menu
                        </a>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="border-ivory-200 flex flex-wrap items-center gap-1 border-t px-3 py-2">
                  <details className="relative">
                    <summary className="text-charcoal-700 hover:bg-ivory-100 cursor-pointer list-none rounded-md px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
                      Edit
                    </summary>
                    <div className="border-ivory-200 shadow-pop absolute left-0 z-20 mt-1 w-72 rounded-lg border bg-white p-4">
                      <ActionForm action={updateTableAction.bind(null, slug)} submitLabel="Save">
                        <input type="hidden" name="tableId" value={t.id} />
                        <Field label="Label" htmlFor={`l-${t.id}`}>
                          <Input id={`l-${t.id}`} name="label" defaultValue={t.label} required maxLength={20} />
                        </Field>
                        <Field label="Area" htmlFor={`a-${t.id}`}>
                          <Input id={`a-${t.id}`} name="area" defaultValue={t.area ?? ""} maxLength={40} />
                        </Field>
                        <Field label="Seats" htmlFor={`s-${t.id}`}>
                          <Input
                            id={`s-${t.id}`}
                            name="seats"
                            type="number"
                            min={1}
                            max={100}
                            defaultValue={t.seats ?? ""}
                          />
                        </Field>
                      </ActionForm>
                    </div>
                  </details>
                  <ActionButton
                    action={regenerateQrAction.bind(null, slug)}
                    fields={{ tableId: t.id }}
                    variant="ghost"
                    confirm={`Replace the QR code for table ${t.label}? The printed code stops working immediately and must be replaced.`}
                  >
                    New QR code
                  </ActionButton>
                  {t.qr ? (
                    <ActionButton
                      action={revokeQrAction.bind(null, slug)}
                      fields={{ tableId: t.id }}
                      variant="ghost"
                      confirm={`Disable ordering by QR at table ${t.label}?`}
                    >
                      Disable QR
                    </ActionButton>
                  ) : null}
                  {t.openSession ? (
                    <ActionButton
                      action={closeSessionAction.bind(null, slug)}
                      fields={{ sessionId: t.openSession.id }}
                      variant="ghost"
                      confirm={`Mark table ${t.label} as free? Its open waiter calls are cleared.`}
                    >
                      Free table
                    </ActionButton>
                  ) : null}
                  <ActionButton
                    action={setTableActiveAction.bind(null, slug)}
                    fields={{
                      tableId: t.id,
                      label: t.label,
                      area: t.area ?? "",
                      seats: t.seats ? String(t.seats) : "",
                      active: String(!t.isActive),
                    }}
                    variant="ghost"
                    confirm={
                      t.isActive ? `Deactivate table ${t.label}? Its QR code stops accepting orders.` : undefined
                    }
                  >
                    {t.isActive ? "Deactivate" : "Activate"}
                  </ActionButton>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
