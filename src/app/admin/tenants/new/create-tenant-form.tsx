"use client";
import { useActionState, useState } from "react";
import Link from "next/link";
import type { ActionResult } from "@/server/action";
import { OneTimeSecret } from "@/components/action-form";
import { Button, buttonClass, Card, CardHeader, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import { FULFILLMENT_HINT, FULFILLMENT_LABEL } from "@/lib/format";
import { createTenantAction } from "../../actions";

type Result = ActionResult<{ tenantId: string; ownerSetupUrl: string | null; ownerExisted: boolean }>;

const slugify = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

export function CreateTenantForm({ plans }: { plans: { id: string; label: string }[] }) {
  const [state, action, pending] = useActionState<Result, FormData>(createTenantAction, { ok: true });
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [subStatus, setSubStatus] = useState("TRIAL");

  if (state.ok && state.data) {
    return (
      <Card className="max-w-2xl px-5 py-5">
        <h2 className="text-lg font-semibold">Restaurant created</h2>
        <p className="text-charcoal-600 mt-1 text-sm">
          It is in onboarding. Next: the owner sets a password, adds the menu and tables, then you switch it live.
        </p>
        <div className="mt-4">
          {state.data.ownerSetupUrl ? (
            <OneTimeSecret
              label="Owner's first-login link"
              value={state.data.ownerSetupUrl}
              note="Send it privately to the owner. It works once and expires in 72 hours; you can issue a new one from the restaurant page."
            />
          ) : (
            <Notice tone="info">The owner already has an account with a password, so no setup link is needed.</Notice>
          )}
        </div>
        <Link href={`/admin/tenants/${state.data.tenantId}`} className={buttonClass("primary", "md", "mt-5")}>
          Open restaurant
        </Link>
      </Card>
    );
  }

  return (
    <form action={action} className="grid max-w-4xl gap-6">
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      <Card>
        <CardHeader title="Restaurant" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Name" htmlFor="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={80}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
            />
          </Field>
          <Field label="Slug" htmlFor="slug" hint="Used in staff URLs, e.g. /app/kampala-grill">
            <Input
              id="slug"
              name="slug"
              required
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              pattern="[a-z0-9]+(-[a-z0-9]+)*"
            />
          </Field>
          <Field label="Registered business name" htmlFor="legalName" hint="Optional, used on invoices">
            <Input id="legalName" name="legalName" maxLength={120} />
          </Field>
          <Field label="Contact email" htmlFor="contactEmail">
            <Input id="contactEmail" name="contactEmail" type="email" />
          </Field>
          <Field label="Phone" htmlFor="contactPhone">
            <Input id="contactPhone" name="contactPhone" maxLength={32} />
          </Field>
          <Field label="City" htmlFor="city">
            <Input id="city" name="city" maxLength={80} defaultValue="Kampala" />
          </Field>
          <Field label="Address" htmlFor="addressLine" className="sm:col-span-2">
            <Input id="addressLine" name="addressLine" maxLength={160} />
          </Field>
          <Field label="Country (ISO)" htmlFor="country">
            <Input id="country" name="country" defaultValue="UG" maxLength={2} />
          </Field>
          <Field label="Currency (ISO)" htmlFor="currency" hint="Cannot change after the first order">
            <Input id="currency" name="currency" defaultValue="UGX" maxLength={3} />
          </Field>
          <Field label="Timezone" htmlFor="timezone">
            <Input id="timezone" name="timezone" defaultValue="Africa/Kampala" />
          </Field>
          <Field label="Locale" htmlFor="locale" hint="Number and date formatting">
            <Input id="locale" name="locale" defaultValue="en-UG" />
          </Field>
          <Field label="Brand colour" htmlFor="brandPrimary">
            <Input
              id="brandPrimary"
              name="brandPrimary"
              type="color"
              defaultValue="#14532D"
              className="h-10 w-24 p-1"
            />
          </Field>
          <Field label="Accent colour" htmlFor="brandAccent">
            <Input id="brandAccent" name="brandAccent" type="color" defaultValue="#A3E635" className="h-10 w-24 p-1" />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="First branch & kitchen" />
        <div className="grid gap-4 px-5 py-5">
          <Field label="Branch name" htmlFor="branchName">
            <Input id="branchName" name="branchName" required maxLength={80} placeholder="e.g. Kololo" />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium">Kitchen fulfilment</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["DIGITAL_DISPLAY", "PRINTER", "DIGITAL_AND_PRINTER", "MANUAL"] as const).map((m) => (
                <label
                  key={m}
                  className="border-ivory-300 has-[:checked]:border-forest-600 has-[:checked]:bg-forest-50 flex cursor-pointer gap-3 rounded-md border p-3"
                >
                  <input
                    type="radio"
                    name="fulfillmentMode"
                    value={m}
                    defaultChecked={m === "DIGITAL_DISPLAY"}
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
          <div className="grid gap-2">
            <Checkbox name="enableWaiterCalls" defaultChecked label="Guests can call a waiter" />
            <Checkbox name="enableBillRequests" defaultChecked label="Guests can request the bill" />
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Owner"
          description="Gets a one-time link to set their password. If the email already has an account, it's reused."
        />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
          <Field label="Owner name" htmlFor="ownerName">
            <Input id="ownerName" name="ownerName" required maxLength={80} />
          </Field>
          <Field label="Owner email" htmlFor="ownerEmail">
            <Input id="ownerEmail" name="ownerEmail" type="email" required />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Subscription & charges" />
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-3">
          <Field label="Plan" htmlFor="planId">
            <Select id="planId" name="planId" required>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Start as" htmlFor="subscriptionStatus">
            <Select
              id="subscriptionStatus"
              name="subscriptionStatus"
              value={subStatus}
              onChange={(e) => setSubStatus(e.target.value)}
            >
              <option value="TRIAL">Trial</option>
              <option value="ACTIVE">Active (paying)</option>
            </Select>
          </Field>
          {subStatus === "TRIAL" ? (
            <Field label="Trial days" htmlFor="trialDays">
              <Input id="trialDays" name="trialDays" type="number" min={0} max={90} defaultValue={14} />
            </Field>
          ) : (
            <div />
          )}
          <div className="grid gap-2 sm:col-span-3">
            <Checkbox name="serviceChargeEnabled" label="Service charge" />
            <Field label="Service charge (%)" htmlFor="serviceChargePercent" className="max-w-40">
              <Input id="serviceChargePercent" name="serviceChargePercent" inputMode="decimal" defaultValue="0" />
            </Field>
            <Checkbox name="taxEnabled" label="Show tax (only with a confirmed rate)" />
            <div className="flex flex-wrap gap-4">
              <Field label="Tax rate (%)" htmlFor="taxRatePercent" className="max-w-40">
                <Input id="taxRatePercent" name="taxRatePercent" inputMode="decimal" defaultValue="0" />
              </Field>
              <Field label="Menu prices" htmlFor="taxInclusive">
                <Select id="taxInclusive" name="taxInclusive" defaultValue="inclusive">
                  <option value="inclusive">Include tax</option>
                  <option value="exclusive">Exclude tax</option>
                </Select>
              </Field>
            </div>
          </div>
        </div>
      </Card>

      <div>
        <Button type="submit" size="lg" disabled={pending || plans.length === 0}>
          {pending ? "Creating…" : "Create restaurant"}
        </Button>
        {plans.length === 0 ? <p className="text-danger-700 mt-2 text-sm">Create a subscription plan first.</p> : null}
      </div>
    </form>
  );
}
