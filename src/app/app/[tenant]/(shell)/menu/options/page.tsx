import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-form";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { toMajorInput } from "@/domain/money";
import { archiveModifierGroupAction, saveModifierGroupAction } from "../actions";
import { ModifierGroupForm } from "./group-form";

export const metadata: Metadata = { title: "Option groups" };

export default async function OptionsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "menu.manage")) notFound();
  const groups = await db.modifierGroup.findMany({
    where: { tenantId: ctx.tenant.id, isArchived: false },
    orderBy: { name: "asc" },
    include: {
      options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } },
      items: { include: { menuItem: { select: { name: true } } } },
    },
  });
  const cur = ctx.tenant.currency;
  const action = saveModifierGroupAction.bind(null, slug);
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/menu`} className="text-forest-700 hover:underline">
          ← Menu
        </Link>
      </p>
      <PageHeader
        title="Option groups"
        description="Reusable choices such as “Choose a side” or “Extras”. Attach them to items on each item's page."
      />
      <div className="grid max-w-5xl gap-6">
        <Card>
          <CardHeader title="New option group" />
          <div className="px-5 py-5">
            <ModifierGroupForm action={action} currency={cur} />
          </div>
        </Card>
        {groups.map((g) => (
          <Card key={g.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {g.name} {g.minSelect > 0 ? <Badge tone="info">Required</Badge> : <Badge>Optional</Badge>}
                </span>
              }
              description={
                g.items.length
                  ? `Used by ${g.items.map((i) => i.menuItem.name).join(", ")}`
                  : "Not attached to any item yet"
              }
              action={
                <ActionButton
                  action={archiveModifierGroupAction.bind(null, slug)}
                  fields={{ groupId: g.id }}
                  variant="ghost"
                  confirm={`Remove “${g.name}” from all items and archive it? Past orders keep their choices.`}
                >
                  Archive
                </ActionButton>
              }
            />
            <div className="px-5 py-5">
              <ModifierGroupForm
                action={action}
                currency={cur}
                group={{
                  id: g.id,
                  name: g.name,
                  minSelect: g.minSelect,
                  maxSelect: g.maxSelect,
                  options: g.options.map((o) => ({
                    id: o.id,
                    name: o.name,
                    price: toMajorInput(o.priceDeltaMinor, cur),
                    isAvailable: o.isAvailable,
                  })),
                }}
              />
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
