import type { Metadata } from "next";
import Link from "next/link";
import { ChefHat, ConciergeBell, Download } from "lucide-react";
import { BranchTabs } from "@/components/branch-tabs";
import { ButtonLink, Card, EmptyState, Input, PageHeader, Table, Td, Th, buttonClass } from "@/components/ui";
import { OrderStatusBadge, PaymentStatusBadge } from "@/components/status";
import { branchesWith, can } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { listOrders } from "@/server/services/orders";
import { elapsed, formatDateTime, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Orders" };
export const dynamic = "force-dynamic";

const SCOPES = [
  { key: "open", label: "Open" },
  { key: "today", label: "Today" },
  { key: "all", label: "Recent" },
] as const;

export default async function OrdersPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ scope?: string; branch?: string; q?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const scope = (SCOPES.find((s) => s.key === sp.scope)?.key ?? "open") as "open" | "today" | "all";
  const branchIds = branchesWith(ctx, "orders.view");
  const branches = await db.branch.findMany({
    where: { tenantId: ctx.tenant.id, id: { in: branchIds } },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const branchId = sp.branch && branchIds.includes(sp.branch) ? sp.branch : null;
  const orders = await listOrders(ctx, { scope, branchId, q: sp.q || null, take: 150 });
  const base = `/app/${slug}/orders`;
  const qs = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const merged = { scope, branch: branchId, q: sp.q ?? null, ...patch };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    return `${base}?${p}`;
  };
  const showMoney = orders.some((o) => o.totalMinor !== null);

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order across your branches. Kitchen and floor screens update live."
        actions={
          <>
            <ButtonLink href={`/app/${slug}/kitchen${branchId ? `?branch=${branchId}` : ""}`} variant="secondary">
              <ChefHat className="size-4" aria-hidden /> Kitchen
            </ButtonLink>
            {can(ctx, "orders.serve") ? (
              <ButtonLink href={`/app/${slug}/floor${branchId ? `?branch=${branchId}` : ""}`} variant="secondary">
                <ConciergeBell className="size-4" aria-hidden /> Floor
              </ButtonLink>
            ) : null}
            {can(ctx, "reports.view") ? (
              <a href={`/api/app/${slug}/export/orders?days=30`} className={buttonClass("ghost")}>
                <Download className="size-4" aria-hidden /> Export CSV
              </a>
            ) : null}
          </>
        }
      />
      {branches.length > 1 ? (
        <BranchTabs
          branches={[{ id: "", name: "All branches" }, ...branches]}
          current={branchId ?? ""}
          hrefFor={(id) => qs({ branch: id || null })}
        />
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="tablist" className="border-ivory-300 inline-flex rounded-md border bg-white p-0.5">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              role="tab"
              aria-selected={s.key === scope}
              href={qs({ scope: s.key })}
              className={cn(
                "rounded px-3 py-1.5 text-sm font-medium",
                s.key === scope ? "bg-forest-800 text-ivory-50" : "text-charcoal-600 hover:bg-ivory-100",
              )}
            >
              {s.label}
            </Link>
          ))}
        </div>
        <form action={base} className="flex items-center gap-2">
          <input type="hidden" name="scope" value={scope} />
          {branchId ? <input type="hidden" name="branch" value={branchId} /> : null}
          <label htmlFor="q" className="sr-only">
            Search by order number or table
          </label>
          <Input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="Order # or table" className="w-48" />
        </form>
      </div>

      <Card>
        {orders.length === 0 ? (
          <EmptyState
            title={scope === "open" ? "No open orders" : "No orders found"}
            description={
              scope === "open"
                ? "New QR orders appear here and on the kitchen screen as soon as they're placed."
                : undefined
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Order</Th>
                <Th>Table</Th>
                {branches.length > 1 ? <Th>Branch</Th> : null}
                <Th>Placed</Th>
                <Th>Items</Th>
                <Th>Status</Th>
                {showMoney ? <Th className="text-right">Total</Th> : null}
                {showMoney ? <Th>Payment</Th> : null}
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-ivory-50">
                  <Td>
                    <Link href={`${base}/${o.id}`} className="text-forest-700 font-mono font-semibold hover:underline">
                      #{o.reference}
                    </Link>
                  </Td>
                  <Td>{o.tableLabel ?? "—"}</Td>
                  {branches.length > 1 ? <Td>{o.branchName}</Td> : null}
                  <Td className="text-charcoal-600 whitespace-nowrap">
                    {scope === "open"
                      ? `${elapsed(o.placedAt)} ago`
                      : formatDateTime(o.placedAt, ctx.tenant.timezone, ctx.tenant.locale)}
                  </Td>
                  <Td className="tabular">{o.itemCount}</Td>
                  <Td>
                    <OrderStatusBadge status={o.status} />
                  </Td>
                  {showMoney ? (
                    <Td className="tabular text-right">
                      {o.totalMinor != null ? formatMoney(o.totalMinor, o.currency, ctx.tenant.locale) : "—"}
                    </Td>
                  ) : null}
                  {showMoney ? (
                    <Td>
                      <PaymentStatusBadge status={o.paymentStatus} />
                    </Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
