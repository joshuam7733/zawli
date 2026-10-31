import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { branchesWith } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { getFloorBoard } from "@/server/services/floor";
import { FloorScreen } from "./floor-screen";

export const metadata: Metadata = { title: "Floor" };
export const dynamic = "force-dynamic";

export default async function FloorPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { tenant: slug } = await params;
  const sp = await searchParams;
  const ctx = await requireTenantPage(slug);
  const allowed = branchesWith(ctx, "orders.view");
  if (allowed.length === 0) notFound();
  const branches = await db.branch.findMany({
    where: { tenantId: ctx.tenant.id, id: { in: allowed }, isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const branch = branches.find((b) => b.id === sp.branch) ?? branches[0];
  if (!branch) notFound();
  const board = await getFloorBoard(ctx, branch.id);
  return (
    <FloorScreen
      key={branch.id}
      tenantSlug={slug}
      tenantName={ctx.tenant.name}
      locale={ctx.tenant.locale}
      timezone={ctx.tenant.timezone}
      branches={branches}
      initial={JSON.parse(JSON.stringify(board))}
    />
  );
}
