import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { ItemForm } from "../../item-form";
import { createItemAction } from "../../actions";

export const metadata: Metadata = { title: "New menu item" };

export default async function NewItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ category?: string }>;
}) {
  const { tenant: slug } = await params;
  const { category } = await searchParams;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "menu.manage")) notFound();
  const categories = await db.menuCategory.findMany({
    where: { tenantId: ctx.tenant.id, isArchived: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/menu`} className="text-forest-700 hover:underline">
          ← Menu
        </Link>
      </p>
      <PageHeader title="New menu item" description="You can add sizes and options after saving." />
      <Card className="max-w-3xl px-5 py-5">
        <ItemForm
          action={createItemAction.bind(null, slug)}
          tenantSlug={slug}
          categories={categories}
          currency={ctx.tenant.currency}
          values={{ categoryId: categories.some((c) => c.id === category) ? category : categories[0]?.id }}
          submitLabel="Create item"
        />
      </Card>
    </>
  );
}
