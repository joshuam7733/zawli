import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { branchesWith, can } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { FULFILLMENT_HINT, FULFILLMENT_LABEL } from "@/lib/format";
import {
  createBranchAction,
  createPrinterAction,
  createStationAction,
  rotateKeyAction,
  saveRoutingAction,
  setDefaultStationAction,
  setPrinterActiveAction,
  setStationActiveAction,
  updateBranchAction,
} from "./actions";
import { PrinterForm, RotateKey } from "./printer-forms";

export const metadata: Metadata = { title: "Branches & kitchen" };

const MODES = ["DIGITAL_DISPLAY", "PRINTER", "DIGITAL_AND_PRINTER", "MANUAL"] as const;

function BranchFields({
  b,
  idPrefix,
}: {
  b?: {
    name: string;
    slug: string;
    addressLine: string | null;
    phone: string | null;
    timezone: string | null;
    fulfillmentMode: string;
  };
  idPrefix: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch name" htmlFor={`${idPrefix}-name`}>
          <Input id={`${idPrefix}-name`} name="name" required maxLength={80} defaultValue={b?.name} />
        </Field>
        <Field label="Short name" htmlFor={`${idPrefix}-slug`} hint="Lowercase, used in file names, e.g. kololo">
          <Input
            id={`${idPrefix}-slug`}
            name="slug"
            required
            maxLength={40}
            defaultValue={b?.slug}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
          />
        </Field>
        <Field label="Address" htmlFor={`${idPrefix}-addr`}>
          <Input id={`${idPrefix}-addr`} name="addressLine" maxLength={160} defaultValue={b?.addressLine ?? ""} />
        </Field>
        <Field label="Phone" htmlFor={`${idPrefix}-phone`}>
          <Input id={`${idPrefix}-phone`} name="phone" maxLength={32} defaultValue={b?.phone ?? ""} />
        </Field>
        <Field label="Timezone" htmlFor={`${idPrefix}-tz`} hint="Leave empty to use the restaurant's timezone.">
          <Input
            id={`${idPrefix}-tz`}
            name="timezone"
            maxLength={60}
            defaultValue={b?.timezone ?? ""}
            placeholder="e.g. Africa/Nairobi"
          />
        </Field>
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How orders reach the kitchen</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <label
              key={m}
              className="border-ivory-300 has-[:checked]:border-forest-600 has-[:checked]:bg-forest-50 flex cursor-pointer gap-3 rounded-md border p-3"
            >
              <input
                type="radio"
                name="fulfillmentMode"
                value={m}
                defaultChecked={(b?.fulfillmentMode ?? "DIGITAL_DISPLAY") === m}
                className="accent-forest-700 mt-0.5 size-4"
              />
              <span>
                <span className="block text-sm font-medium">{FULFILLMENT_LABEL[m]}</span>
                <span className="text-charcoal-500 block text-xs">{FULFILLMENT_HINT[m]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}

export default async function BranchesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  const manageBranches = can(ctx, "branch.manage");
  const kitchenBranches = branchesWith(ctx, "printing.manage");
  if (!manageBranches && kitchenBranches.length === 0) notFound();
  const [branches, categories, sub] = await Promise.all([
    db.branch.findMany({
      where: { tenantId: ctx.tenant.id, id: { in: manageBranches ? undefined : kitchenBranches } },
      orderBy: { createdAt: "asc" },
      include: {
        stations: { orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }, { name: "asc" }] },
        routingRules: true,
        printers: { orderBy: { createdAt: "asc" }, include: { station: { select: { name: true } } } },
        _count: { select: { tables: true } },
      },
    }),
    db.menuCategory.findMany({
      where: { tenantId: ctx.tenant.id, isArchived: false },
      orderBy: { sortOrder: "asc" },
      select: { id: true, name: true },
    }),
    db.subscription.findUnique({ where: { tenantId: ctx.tenant.id }, include: { plan: true } }),
  ]);
  const writable = ctx.tenant.status !== "SUSPENDED";
  const atLimit = sub?.plan.maxBranches != null && branches.length >= sub.plan.maxBranches;

  return (
    <>
      <PageHeader
        title="Branches & kitchen"
        description="Choose how each branch's kitchen receives orders, set up stations, routing and printers."
      />
      <div className="flex max-w-5xl flex-col gap-8">
        {branches.map((b) => {
          const canKitchen = writable && kitchenBranches.includes(b.id);
          const activeStations = b.stations.filter((s) => s.isActive);
          return (
            <section key={b.id} aria-labelledby={`branch-${b.id}`} className="flex flex-col gap-4">
              <h2
                id={`branch-${b.id}`}
                className="font-display flex flex-wrap items-center gap-2 text-xl font-semibold"
              >
                {b.name}
                <Badge tone="forest">{FULFILLMENT_LABEL[b.fulfillmentMode]}</Badge>
                {!b.isActive ? <Badge tone="danger">Inactive</Badge> : null}
                <span className="text-charcoal-500 text-sm font-normal">{b._count.tables} tables</span>
              </h2>

              {manageBranches && writable ? (
                <Card>
                  <details>
                    <summary className="cursor-pointer px-5 py-4 text-sm font-semibold">
                      Branch details & kitchen mode
                    </summary>
                    <div className="border-ivory-200 border-t px-5 py-5">
                      <ActionForm action={updateBranchAction.bind(null, slug)} submitLabel="Save branch">
                        <input type="hidden" name="branchId" value={b.id} />
                        <BranchFields b={b} idPrefix={`b-${b.id}`} />
                        <Checkbox
                          name="isActive"
                          defaultChecked={b.isActive}
                          label="Branch is open"
                          hint="Inactive branches stop accepting QR orders."
                        />
                      </ActionForm>
                    </div>
                  </details>
                </Card>
              ) : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader
                    title="Kitchen stations"
                    description="Split tickets by station, e.g. Grill and Bar. Unrouted items go to the default."
                  />
                  <ul className="divide-ivory-200 divide-y">
                    {b.stations.map((st) => (
                      <li key={st.id} className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-sm">
                        <span className={st.isActive ? "font-medium" : "text-charcoal-400 line-through"}>
                          {st.name}
                        </span>
                        {st.isDefault ? <Badge tone="forest">Default</Badge> : null}
                        {canKitchen ? (
                          <span className="ml-auto flex gap-1">
                            {!st.isDefault && st.isActive ? (
                              <ActionButton
                                action={setDefaultStationAction.bind(null, slug)}
                                fields={{ stationId: st.id }}
                                variant="ghost"
                              >
                                Make default
                              </ActionButton>
                            ) : null}
                            {!st.isDefault ? (
                              <ActionButton
                                action={setStationActiveAction.bind(null, slug)}
                                fields={{ stationId: st.id, active: String(!st.isActive) }}
                                variant="ghost"
                              >
                                {st.isActive ? "Turn off" : "Turn on"}
                              </ActionButton>
                            ) : null}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                  {canKitchen ? (
                    <div className="border-ivory-200 border-t px-5 py-4">
                      <ActionForm
                        action={createStationAction.bind(null, slug)}
                        submitLabel="Add station"
                        submitVariant="secondary"
                        resetOnSuccess
                      >
                        <input type="hidden" name="branchId" value={b.id} />
                        <Field label="New station name" htmlFor={`st-${b.id}`}>
                          <Input id={`st-${b.id}`} name="name" required maxLength={40} placeholder="e.g. Bar" />
                        </Field>
                      </ActionForm>
                    </div>
                  ) : null}
                </Card>

                <Card>
                  <CardHeader title="Routing" description="Which station prepares each menu category at this branch." />
                  {activeStations.length < 2 ? (
                    <p className="text-charcoal-500 px-5 py-4 text-sm">
                      Everything goes to {activeStations[0]?.name ?? "the default station"}. Add a second station to
                      split tickets.
                    </p>
                  ) : categories.length === 0 ? (
                    <p className="text-charcoal-500 px-5 py-4 text-sm">Add menu categories first.</p>
                  ) : (
                    <div className="px-5 py-4">
                      <ActionForm
                        action={saveRoutingAction.bind(null, slug)}
                        submitLabel="Save routing"
                        submitVariant="secondary"
                      >
                        <input type="hidden" name="branchId" value={b.id} />
                        <div className="grid gap-3">
                          {categories.map((c) => {
                            const rule = b.routingRules.find((r) => r.categoryId === c.id);
                            return (
                              <div
                                key={c.id}
                                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3"
                              >
                                <label htmlFor={`r-${b.id}-${c.id}`} className="truncate text-sm">
                                  {c.name}
                                </label>
                                <Select
                                  id={`r-${b.id}-${c.id}`}
                                  name={`route:${c.id}`}
                                  defaultValue={rule?.stationId ?? ""}
                                  disabled={!canKitchen}
                                >
                                  <option value="">Default station</option>
                                  {activeStations.map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.name}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            );
                          })}
                        </div>
                      </ActionForm>
                    </div>
                  )}
                </Card>
              </div>

              {b.fulfillmentMode === "PRINTER" ||
              b.fulfillmentMode === "DIGITAL_AND_PRINTER" ||
              b.printers.length > 0 ? (
                <Card>
                  <CardHeader
                    title="Printers"
                    description="Each new kitchen ticket is queued once per matching printer. Reprints never create a second order."
                  />
                  {b.printers.length === 0 ? (
                    <p className="text-warning-700 px-5 py-4 text-sm">
                      No printer set up — tickets won&apos;t be queued for printing at this branch.
                    </p>
                  ) : (
                    <ul className="divide-ivory-200 divide-y">
                      {b.printers.map((p) => (
                        <li key={p.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                          <span className="font-medium">{p.name}</span>
                          <Badge>{p.connection === "BROWSER" ? "Browser print" : "Print bridge"}</Badge>
                          <Badge>{p.paperWidthMm === 210 ? "A4" : `${p.paperWidthMm} mm`}</Badge>
                          <span className="text-charcoal-500">{p.station?.name ?? "All stations"}</span>
                          {!p.isActive ? <Badge tone="danger">Off</Badge> : null}
                          {canKitchen ? (
                            <span className="ml-auto flex gap-1">
                              {p.connection === "PRINT_BRIDGE" ? (
                                <RotateKey action={rotateKeyAction.bind(null, slug)} printerId={p.id} />
                              ) : null}
                              <ActionButton
                                action={setPrinterActiveAction.bind(null, slug)}
                                fields={{ printerId: p.id, active: String(!p.isActive) }}
                                variant="ghost"
                              >
                                {p.isActive ? "Turn off" : "Turn on"}
                              </ActionButton>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {canKitchen ? (
                    <div className="border-ivory-200 border-t px-5 py-5">
                      <PrinterForm
                        action={createPrinterAction.bind(null, slug)}
                        branchId={b.id}
                        stations={activeStations.map((s) => ({ id: s.id, name: s.name }))}
                      />
                    </div>
                  ) : null}
                </Card>
              ) : null}
            </section>
          );
        })}

        {manageBranches && writable ? (
          <Card>
            <CardHeader
              title="Add a branch"
              description={
                atLimit
                  ? `Your ${sub?.plan.name} plan includes ${sub?.plan.maxBranches} branch(es). Contact us to add more.`
                  : "A default kitchen station is created automatically."
              }
            />
            {!atLimit ? (
              <div className="px-5 py-5">
                <ActionForm action={createBranchAction.bind(null, slug)} submitLabel="Create branch" resetOnSuccess>
                  <BranchFields idPrefix="new-branch" />
                </ActionForm>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}
