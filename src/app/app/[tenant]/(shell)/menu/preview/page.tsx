import type { Metadata } from "next";
import Link from "next/link";
import { BranchTabs, pickBranch } from "@/components/branch-tabs";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { getPublicMenu, payFirstSettings, type ResolvedTable } from "@/server/services/ordering";
import { CustomerMenu } from "@/app/t/[token]/customer-menu";

export const metadata: Metadata = { title: "Menu preview" };

/** Shows the customer menu exactly as guests see it at one branch (nothing can be ordered). */
export default async function MenuPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const [tenant, branches] = await Promise.all([
    db.tenant.findUniqueOrThrow({
      where: { id: ctx.tenant.id },
      include: { settings: true, mobileMoney: { where: { isEnabled: true }, select: { provider: true } } },
    }),
    db.branch.findMany({
      where: { tenantId: ctx.tenant.id, id: { in: [...ctx.branchRoles.keys()] } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  const branch = pickBranch(branches, sp.branch)!;
  const menu = await getPublicMenu(ctx.tenant.id, branch.id);
  const s = tenant.settings!;
  const info: ResolvedTable = {
    tenant: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      currency: tenant.currency,
      locale: tenant.locale,
      timezone: tenant.timezone,
      logoUrl: tenant.logoUrl,
      brandPrimary: tenant.brandPrimary,
      brandAccent: tenant.brandAccent,
      isDemo: tenant.isDemo,
    },
    branch: { id: branch.id, name: branch.name, fulfillmentMode: branch.fulfillmentMode },
    table: { id: "preview", label: "—" },
    settings: {
      enableWaiterCalls: s.enableWaiterCalls,
      enableBillRequests: s.enableBillRequests,
      enableOrderTracking: s.enableOrderTracking,
      allowItemNotes: s.allowItemNotes,
      maxItemQuantity: s.maxItemQuantity,
      tableSessionIdleMinutes: s.tableSessionIdleMinutes,
      taxEnabled: s.taxEnabled,
      taxRateBps: s.taxRateBps,
      taxInclusive: s.taxInclusive,
      taxLabel: s.taxLabel,
      serviceChargeEnabled: s.serviceChargeEnabled,
      serviceChargeBps: s.serviceChargeBps,
      serviceChargeLabel: s.serviceChargeLabel,
      ...payFirstSettings(s, tenant.mobileMoney),
    },
  };
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/menu`} className="text-forest-700 hover:underline">
          ← Menu
        </Link>
      </p>
      <h1 className="font-display mb-4 text-2xl font-semibold">Customer menu preview</h1>
      <BranchTabs branches={branches} current={branch.id} hrefFor={(id) => `/app/${slug}/menu/preview?branch=${id}`} />
      <div className="border-charcoal-900 shadow-pop mx-auto max-w-[420px] overflow-hidden rounded-[28px] border-8">
        {/* transform makes the menu's fixed bars/sheets position inside the phone frame */}
        <div className="h-[760px] [transform:translateZ(0)] overflow-y-auto">
          <CustomerMenu token="preview" info={info} menu={menu} preview />
        </div>
      </div>
    </>
  );
}
