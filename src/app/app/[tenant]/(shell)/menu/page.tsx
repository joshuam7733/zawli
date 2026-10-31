import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, Eye, ImageOff, Plus, SlidersHorizontal } from "lucide-react";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, ButtonLink, Card, CardHeader, EmptyState, Field, Input, PageHeader } from "@/components/ui";
import { can } from "@/server/authz";
import { requireTenantPage } from "@/server/session";
import { getMenuAdmin } from "@/server/services/menu";
import { formatMoney } from "@/lib/format";
import {
  archiveCategoryAction,
  archiveItemAction,
  createCategoryAction,
  moveCategoryAction,
  setItemAvailableAction,
  updateCategoryAction,
} from "./actions";

export const metadata: Metadata = { title: "Menu" };

export default async function MenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ archived?: string }>;
}) {
  const { tenant: slug } = await params;
  const { archived } = await searchParams;
  const showArchived = archived === "1";
  const ctx = await requireTenantPage(slug);
  const { categories, groups, branches } = await getMenuAdmin(ctx);
  const manage = can(ctx, "menu.manage");
  const base = `/app/${slug}/menu`;
  const money = (m: number) => formatMoney(m, ctx.tenant.currency, ctx.tenant.locale);
  const visible = categories.filter((c) => showArchived || !c.isArchived);
  const activeCategories = categories.filter((c) => !c.isArchived);

  return (
    <>
      <PageHeader
        title="Menu"
        description={
          manage
            ? "Categories, items, sizes and options. Changes reach customer menus immediately."
            : "Mark items as sold out or back in stock."
        }
        actions={
          <>
            <ButtonLink href={`${base}/preview`} variant="secondary">
              <Eye className="size-4" aria-hidden /> Preview
            </ButtonLink>
            {manage ? (
              <ButtonLink href={`${base}/options`} variant="secondary">
                <SlidersHorizontal className="size-4" aria-hidden /> Option groups ({groups.length})
              </ButtonLink>
            ) : null}
            {manage && activeCategories.length > 0 ? (
              <ButtonLink href={`${base}/items/new`}>
                <Plus className="size-4" aria-hidden /> New item
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {manage ? (
        <Card className="mb-6">
          <CardHeader title="Add a category" description="For example: Grills, Local favourites, Drinks." />
          <div className="px-5 py-4">
            <ActionForm
              action={createCategoryAction.bind(null, slug)}
              submitLabel="Add category"
              resetOnSuccess
              className="sm:flex-row sm:items-end"
            >
              <Field label="Name" htmlFor="new-category" className="flex-1">
                <Input id="new-category" name="name" required maxLength={60} placeholder="e.g. Grills" />
              </Field>
            </ActionForm>
          </div>
        </Card>
      ) : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="Your menu is empty"
            description={
              manage ? "Add a category above, then add items to it." : "A manager has not set up the menu yet."
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {visible.map((cat, ci) => {
            const items = cat.items.filter((i) => showArchived || !i.isArchived);
            return (
              <Card key={cat.id} className={cat.isArchived ? "opacity-70" : undefined}>
                <div className="border-ivory-200 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <h2 className="truncate text-base font-semibold">{cat.name}</h2>
                    <span className="text-charcoal-500 text-sm">
                      {items.length} item{items.length === 1 ? "" : "s"}
                    </span>
                    {cat.isArchived ? <Badge>Archived</Badge> : null}
                  </div>
                  {manage ? (
                    <div className="flex flex-wrap items-center gap-1">
                      {!cat.isArchived ? (
                        <>
                          <ActionButton
                            action={moveCategoryAction.bind(null, slug)}
                            fields={{ categoryId: cat.id, direction: "up" }}
                            variant="ghost"
                            className={ci === 0 ? "invisible" : undefined}
                          >
                            <ArrowUp className="size-4" aria-label="Move up" />
                          </ActionButton>
                          <ActionButton
                            action={moveCategoryAction.bind(null, slug)}
                            fields={{ categoryId: cat.id, direction: "down" }}
                            variant="ghost"
                          >
                            <ArrowDown className="size-4" aria-label="Move down" />
                          </ActionButton>
                          <details className="relative">
                            <summary className="text-charcoal-700 hover:bg-ivory-100 cursor-pointer list-none rounded-md px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
                              Rename
                            </summary>
                            <div className="border-ivory-200 shadow-pop absolute right-0 z-20 mt-1 w-72 rounded-lg border bg-white p-4">
                              <ActionForm action={updateCategoryAction.bind(null, slug)} submitLabel="Save">
                                <input type="hidden" name="categoryId" value={cat.id} />
                                <Field label="Category name" htmlFor={`cat-${cat.id}`}>
                                  <Input
                                    id={`cat-${cat.id}`}
                                    name="name"
                                    defaultValue={cat.name}
                                    required
                                    maxLength={60}
                                  />
                                </Field>
                              </ActionForm>
                            </div>
                          </details>
                          <ButtonLink href={`${base}/items/new?category=${cat.id}`} variant="ghost" size="sm">
                            <Plus className="size-4" aria-hidden /> Item
                          </ButtonLink>
                        </>
                      ) : null}
                      <ActionButton
                        action={archiveCategoryAction.bind(null, slug)}
                        fields={{ categoryId: cat.id, archived: String(!cat.isArchived) }}
                        variant="ghost"
                        confirm={
                          cat.isArchived
                            ? undefined
                            : `Archive “${cat.name}”? Its items disappear from customer menus. Past orders are kept.`
                        }
                      >
                        {cat.isArchived ? "Restore" : "Archive"}
                      </ActionButton>
                    </div>
                  ) : null}
                </div>
                {items.length === 0 ? (
                  <p className="text-charcoal-500 px-5 py-6 text-sm">No items in this category yet.</p>
                ) : (
                  <ul className="divide-ivory-200 divide-y">
                    {items.map((item) => {
                      const prices = item.variants.map((v) => v.priceMinor);
                      const price = prices.length
                        ? `${prices.length > 1 ? "from " : ""}${money(Math.min(...prices))}`
                        : money(item.basePriceMinor);
                      const soldOutAt = item.branchSettings.filter((b) => !b.isAvailable || !b.isOffered).length;
                      return (
                        <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
                          <div className="bg-ivory-100 size-12 shrink-0 overflow-hidden rounded-md">
                            {item.imageUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.imageUrl} alt="" className="size-full object-cover" />
                            ) : (
                              <ImageOff className="text-charcoal-300 m-auto mt-3.5 size-5" aria-hidden />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-2">
                              {manage ? (
                                <Link
                                  href={`${base}/items/${item.id}`}
                                  className="text-charcoal-950 hover:text-forest-700 font-medium hover:underline"
                                >
                                  {item.name}
                                </Link>
                              ) : (
                                <span className="font-medium">{item.name}</span>
                              )}
                              {!item.isAvailable ? <Badge tone="danger">Sold out</Badge> : null}
                              {item.isArchived ? <Badge>Archived</Badge> : null}
                              {soldOutAt > 0 && item.isAvailable ? (
                                <Badge tone="warning">
                                  Off at {soldOutAt} of {branches.length} branch{branches.length === 1 ? "" : "es"}
                                </Badge>
                              ) : null}
                            </p>
                            <p className="text-charcoal-500 mt-0.5 text-sm">
                              <span className="tabular">{price}</span>
                              {item.variants.length > 1 ? ` · ${item.variants.length} sizes` : ""}
                              {item.modifierGroups.length
                                ? ` · ${item.modifierGroups.map((g) => g.modifierGroup.name).join(", ")}`
                                : ""}
                            </p>
                          </div>
                          {!item.isArchived ? (
                            <ActionButton
                              action={setItemAvailableAction.bind(null, slug)}
                              fields={{ itemId: item.id, available: String(!item.isAvailable) }}
                              variant={item.isAvailable ? "secondary" : "accent"}
                            >
                              {item.isAvailable ? "Mark sold out" : "Back in stock"}
                            </ActionButton>
                          ) : null}
                          {manage ? (
                            <ActionButton
                              action={archiveItemAction.bind(null, slug)}
                              fields={{ itemId: item.id, archived: String(!item.isArchived) }}
                              variant="ghost"
                              confirm={
                                item.isArchived
                                  ? undefined
                                  : `Archive “${item.name}”? It disappears from the menu; past orders keep it.`
                              }
                            >
                              {item.isArchived ? "Restore" : "Archive"}
                            </ActionButton>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <p className="mt-6 text-sm">
        <Link href={showArchived ? base : `${base}?archived=1`} className="text-forest-700 font-medium hover:underline">
          {showArchived ? "Hide archived" : "Show archived categories and items"}
        </Link>
      </p>
    </>
  );
}
