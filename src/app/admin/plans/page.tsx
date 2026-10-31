import type { Metadata } from "next";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { platformRoleHasPermission } from "@/domain/permissions";
import { toMajorInput } from "@/domain/money";
import { requirePlatformPage } from "@/server/session";
import { listPlans } from "@/server/services/billing";
import { formatMoney } from "@/lib/format";
import { savePlanAction } from "../actions";

export const metadata: Metadata = { title: "Plans" };

type Plan = Awaited<ReturnType<typeof listPlans>>[number];

function PlanFields({ p }: { p?: Plan }) {
  const id = p?.id ?? "new";
  return (
    <>
      {p ? <input type="hidden" name="planId" value={p.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Code" htmlFor={`code-${id}`} hint="e.g. starter">
          <Input id={`code-${id}`} name="code" required defaultValue={p?.code} />
        </Field>
        <Field label="Name" htmlFor={`name-${id}`}>
          <Input id={`name-${id}`} name="name" required defaultValue={p?.name} />
        </Field>
        <Field label="Max branches" htmlFor={`mb-${id}`} hint="Empty = unlimited">
          <Input id={`mb-${id}`} name="maxBranches" type="number" min={1} defaultValue={p?.maxBranches ?? ""} />
        </Field>
        <Field label="Price" htmlFor={`price-${id}`}>
          <Input
            id={`price-${id}`}
            name="price"
            required
            inputMode="decimal"
            defaultValue={p ? toMajorInput(p.priceMinor, p.currency) : ""}
          />
        </Field>
        <Field label="Currency" htmlFor={`cur-${id}`}>
          <Input id={`cur-${id}`} name="currency" required maxLength={3} defaultValue={p?.currency ?? "UGX"} />
        </Field>
        <Field label="Billed" htmlFor={`int-${id}`}>
          <Select id={`int-${id}`} name="billingInterval" defaultValue={p?.billingInterval ?? "MONTHLY"}>
            <option value="MONTHLY">Monthly</option>
            <option value="YEARLY">Yearly</option>
          </Select>
        </Field>
      </div>
      <Field label="Description" htmlFor={`desc-${id}`}>
        <Input id={`desc-${id}`} name="description" maxLength={300} defaultValue={p?.description ?? ""} />
      </Field>
      <Checkbox name="isActive" defaultChecked={p?.isActive ?? true} label="Available for new subscriptions" />
    </>
  );
}

export default async function PlansPage() {
  const { user } = await requirePlatformPage("platform.tenants.view");
  const plans = await listPlans(user);
  const canEdit = platformRoleHasPermission(user?.platformRole, "platform.plans.manage");
  return (
    <>
      <PageHeader
        title="Subscription plans"
        description="What restaurants pay us. Changing a price affects new invoices only."
      />
      <div className="grid max-w-4xl gap-6">
        {plans.map((p) => (
          <Card key={p.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  {p.name} {!p.isActive ? <Badge>Retired</Badge> : null}
                </span>
              }
              description={`${formatMoney(p.priceMinor, p.currency)} / ${p.billingInterval === "MONTHLY" ? "month" : "year"} · ${p.maxBranches ?? "unlimited"} branch(es) · ${p._count.subscriptions} subscriber(s)`}
            />
            {canEdit ? (
              <details>
                <summary className="text-forest-700 cursor-pointer px-5 py-3 text-sm font-medium">Edit</summary>
                <div className="px-5 pb-5">
                  <ActionForm action={savePlanAction} submitLabel="Save plan">
                    <PlanFields p={p} />
                  </ActionForm>
                </div>
              </details>
            ) : null}
          </Card>
        ))}
        {canEdit ? (
          <Card>
            <CardHeader title="New plan" />
            <div className="px-5 py-5">
              <ActionForm action={savePlanAction} submitLabel="Create plan" resetOnSuccess>
                <PlanFields />
              </ActionForm>
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
