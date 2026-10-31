import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Notice, PageHeader, Table, Td, Th } from "@/components/ui";
import { can } from "@/server/authz";
import { db } from "@/server/db";
import { isAppError } from "@/server/errors";
import { requireTenantPage } from "@/server/session";
import { getMenuItemAdmin } from "@/server/services/menu";
import { toMajorInput } from "@/domain/money";
import { formatMoney } from "@/lib/format";
import { ItemForm } from "../../item-form";
import { VariantsForm } from "../../variants-editor";
import { branchOverrideAction, saveVariantsAction, setItemGroupsAction, updateItemAction } from "../../actions";

export const metadata: Metadata = { title: "Edit menu item" };

export default async function EditItemPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string; id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { tenant: slug, id } = await params;
  const { created } = await searchParams;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "menu.manage")) notFound();
  const item = await getMenuItemAdmin(ctx, id).catch((e) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [categories, groups, branches] = await Promise.all([
    db.menuCategory.findMany({
      where: { tenantId: ctx.tenant.id, OR: [{ isArchived: false }, { id: item.categoryId }] },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    db.modifierGroup.findMany({
      where: { tenantId: ctx.tenant.id, isArchived: false },
      orderBy: { name: "asc" },
      include: { options: { where: { isArchived: false }, orderBy: { sortOrder: "asc" } } },
    }),
    db.branch.findMany({ where: { tenantId: ctx.tenant.id }, orderBy: { createdAt: "asc" } }),
  ]);
  const cur = ctx.tenant.currency;
  const selected = new Set(item.modifierGroups.map((g) => g.modifierGroupId));
  const orderedGroups = [
    ...item.modifierGroups
      .map((g) => groups.find((x) => x.id === g.modifierGroupId))
      .filter((g): g is (typeof groups)[number] => !!g),
    ...groups.filter((g) => !selected.has(g.id)),
  ];

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href={`/app/${slug}/menu`} className="text-forest-700 hover:underline">
          ← Menu
        </Link>
      </p>
      <PageHeader
        title={item.name}
        description={item.category.name}
        actions={
          <>
            {item.isArchived ? <Badge>Archived</Badge> : null}
            {!item.isAvailable ? <Badge tone="danger">Sold out everywhere</Badge> : null}
          </>
        }
      />
      {created ? (
        <Notice tone="forest" className="mb-6 max-w-3xl">
          Item created. Add sizes or options below if it needs them.
        </Notice>
      ) : null}

      <div className="grid max-w-5xl gap-6 xl:grid-cols-2">
        <Card className="xl:col-span-2">
          <CardHeader title="Details" />
          <div className="px-5 py-5">
            <ItemForm
              action={updateItemAction.bind(null, slug)}
              tenantSlug={slug}
              categories={categories}
              currency={cur}
              hasVariants={item.variants.length > 0}
              submitLabel="Save item"
              values={{
                itemId: item.id,
                categoryId: item.categoryId,
                name: item.name,
                description: item.description,
                price: toMajorInput(item.basePriceMinor, cur),
                allergens: item.allergens,
                prepNotes: item.prepNotes,
                imageUrl: item.imageUrl,
                isAvailable: item.isAvailable,
              }}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Sizes" description="e.g. Half kg / 1 kg, Glass / Jug. Customers must pick one." />
          <div className="px-5 py-5">
            <VariantsForm
              action={saveVariantsAction.bind(null, slug)}
              itemId={item.id}
              currency={cur}
              initial={item.variants.map((v) => ({
                id: v.id,
                name: v.name,
                price: toMajorInput(v.priceMinor, cur),
                isAvailable: v.isAvailable,
              }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Options"
            description="Sides, extras, sauces. Required groups must be chosen before ordering."
            action={
              <Link href={`/app/${slug}/menu/options`} className="text-forest-700 text-sm font-medium hover:underline">
                Manage groups
              </Link>
            }
          />
          <div className="px-5 py-5">
            {groups.length === 0 ? (
              <p className="text-charcoal-500 text-sm">
                No option groups yet.{" "}
                <Link href={`/app/${slug}/menu/options`} className="text-forest-700 font-medium hover:underline">
                  Create one
                </Link>
                .
              </p>
            ) : (
              <ActionForm action={setItemGroupsAction.bind(null, slug)} submitLabel="Save options">
                <input type="hidden" name="itemId" value={item.id} />
                <ul className="flex flex-col gap-3">
                  {orderedGroups.map((g) => (
                    <li key={g.id}>
                      <label className="flex cursor-pointer items-start gap-3">
                        <input
                          type="checkbox"
                          name="groupId"
                          value={g.id}
                          defaultChecked={selected.has(g.id)}
                          className="accent-forest-700 mt-0.5 size-4"
                        />
                        <span>
                          <span className="text-sm font-medium">{g.name}</span>{" "}
                          {g.minSelect > 0 ? <Badge tone="info">Required</Badge> : <Badge>Optional</Badge>}
                          <span className="text-charcoal-500 block text-xs">
                            {g.options
                              .map(
                                (o) =>
                                  `${o.name}${o.priceDeltaMinor ? ` +${formatMoney(o.priceDeltaMinor, cur, ctx.tenant.locale)}` : ""}`,
                              )
                              .join(" · ")}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </ActionForm>
            )}
          </div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Branches"
            description="Whether each branch offers this item, and whether it is in stock there today."
          />
          <Table>
            <thead>
              <tr>
                <Th>Branch</Th>
                <Th>On this branch&apos;s menu</Th>
                <Th>In stock</Th>
              </tr>
            </thead>
            <tbody>
              {branches.map((b) => {
                const o = item.branchSettings.find((s) => s.branchId === b.id);
                const offered = o?.isOffered ?? true;
                const available = o?.isAvailable ?? true;
                return (
                  <tr key={b.id}>
                    <Td className="font-medium">{b.name}</Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        {offered ? <Badge tone="forest">Offered</Badge> : <Badge>Not offered</Badge>}
                        <ActionButton
                          action={branchOverrideAction.bind(null, slug)}
                          fields={{ itemId: item.id, branchId: b.id, field: "offered", value: String(!offered) }}
                          variant="ghost"
                        >
                          {offered ? "Remove" : "Offer"}
                        </ActionButton>
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        {available ? <Badge tone="forest">In stock</Badge> : <Badge tone="danger">Sold out</Badge>}
                        <ActionButton
                          action={branchOverrideAction.bind(null, slug)}
                          fields={{ itemId: item.id, branchId: b.id, field: "available", value: String(!available) }}
                          variant="ghost"
                        >
                          {available ? "Mark sold out" : "Back in stock"}
                        </ActionButton>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
