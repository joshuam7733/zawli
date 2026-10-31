import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { ImageUpload } from "@/components/image-upload";
import { Card, CardHeader, Checkbox, Field, Input, PageHeader, Select } from "@/components/ui";
import { can } from "@/server/authz";
import { requireTenantPage } from "@/server/session";
import { getRestaurantSettings } from "@/server/services/restaurant";
import { getMobileMoneySettings } from "@/server/services/mobile-money";
import { updateProfileAction, updateSettingsAction } from "./actions";
import { MobileMoneySettings } from "./mobile-money-settings";

export const metadata: Metadata = { title: "Restaurant settings" };

export default async function SettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "tenant.settings.manage")) notFound();
  const [t, mm] = await Promise.all([getRestaurantSettings(ctx), getMobileMoneySettings(ctx)]);
  const s = t.settings!;

  return (
    <>
      <PageHeader
        title="Restaurant settings"
        description="Your public profile, guest features and charges. Currency and timezone are set by the platform team."
      />
      <div className="grid max-w-4xl gap-6">
        <Card>
          <CardHeader title="Profile & branding" description="Shown at the top of your QR menu." />
          <div className="px-5 py-5">
            <ActionForm action={updateProfileAction.bind(null, slug)} submitLabel="Save profile">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Restaurant name" htmlFor="name">
                  <Input id="name" name="name" required maxLength={80} defaultValue={t.name} />
                </Field>
                <Field label="Contact email" htmlFor="contactEmail">
                  <Input id="contactEmail" name="contactEmail" type="email" defaultValue={t.contactEmail ?? ""} />
                </Field>
                <Field label="Phone" htmlFor="contactPhone">
                  <Input id="contactPhone" name="contactPhone" defaultValue={t.contactPhone ?? ""} maxLength={32} />
                </Field>
                <Field label="City" htmlFor="city">
                  <Input id="city" name="city" defaultValue={t.city ?? ""} maxLength={80} />
                </Field>
                <Field label="Address" htmlFor="addressLine" className="sm:col-span-2">
                  <Input id="addressLine" name="addressLine" defaultValue={t.addressLine ?? ""} maxLength={160} />
                </Field>
                <Field label="Brand colour" htmlFor="brandPrimary" hint="Menu header background">
                  <Input
                    id="brandPrimary"
                    name="brandPrimary"
                    type="color"
                    defaultValue={t.brandPrimary}
                    className="h-10 w-24 p-1"
                  />
                </Field>
                <Field label="Accent colour" htmlFor="brandAccent">
                  <Input
                    id="brandAccent"
                    name="brandAccent"
                    type="color"
                    defaultValue={t.brandAccent}
                    className="h-10 w-24 p-1"
                  />
                </Field>
              </div>
              <ImageUpload tenantSlug={slug} name="logoUrl" defaultValue={t.logoUrl} label="Logo" />
              <p className="text-charcoal-500 text-xs">
                Currency {t.currency} · timezone {t.timezone} · locale {t.locale}
              </p>
            </ActionForm>
          </div>
        </Card>

        <MobileMoneySettings slug={slug} settings={mm} />

        <Card>
          <CardHeader title="Guests, charges and kitchen" />
          <div className="px-5 py-5">
            <ActionForm action={updateSettingsAction.bind(null, slug)} submitLabel="Save settings">
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-sm font-semibold">At the table</legend>
                <Checkbox
                  name="enableWaiterCalls"
                  defaultChecked={s.enableWaiterCalls}
                  label="Guests can call a waiter"
                />
                <Checkbox
                  name="enableBillRequests"
                  defaultChecked={s.enableBillRequests}
                  label="Guests can request the bill"
                />
                <Checkbox
                  name="enableOrderTracking"
                  defaultChecked={s.enableOrderTracking}
                  label="Guests see order progress (preparing, ready…)"
                />
                <Checkbox
                  name="allowItemNotes"
                  defaultChecked={s.allowItemNotes}
                  label="Guests can add notes to items"
                />
              </fieldset>

              <fieldset className="border-ivory-200 grid gap-4 border-t pt-4">
                <legend className="text-sm font-semibold">Service charge</legend>
                <Checkbox
                  name="serviceChargeEnabled"
                  defaultChecked={s.serviceChargeEnabled}
                  label="Add a service charge to every order"
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Label" htmlFor="serviceChargeLabel">
                    <Input
                      id="serviceChargeLabel"
                      name="serviceChargeLabel"
                      defaultValue={s.serviceChargeLabel}
                      maxLength={30}
                    />
                  </Field>
                  <Field label="Rate (%)" htmlFor="serviceChargePercent">
                    <Input
                      id="serviceChargePercent"
                      name="serviceChargePercent"
                      inputMode="decimal"
                      defaultValue={s.serviceChargeBps / 100}
                    />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="border-ivory-200 grid gap-4 border-t pt-4">
                <legend className="text-sm font-semibold">Tax</legend>
                <p className="text-charcoal-600 text-sm">
                  {
                    "Zawli doesn't assume any tax rule. Only turn this on with the rate and treatment your accountant or tax authority confirms."
                  }
                </p>
                <Checkbox name="taxEnabled" defaultChecked={s.taxEnabled} label="Show tax on orders" />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Label" htmlFor="taxLabel">
                    <Input id="taxLabel" name="taxLabel" defaultValue={s.taxLabel} maxLength={30} />
                  </Field>
                  <Field label="Rate (%)" htmlFor="taxRatePercent">
                    <Input
                      id="taxRatePercent"
                      name="taxRatePercent"
                      inputMode="decimal"
                      defaultValue={s.taxRateBps / 100}
                    />
                  </Field>
                  <Field label="Menu prices" htmlFor="taxInclusive">
                    <Select
                      id="taxInclusive"
                      name="taxInclusive"
                      defaultValue={s.taxInclusive ? "inclusive" : "exclusive"}
                    >
                      <option value="inclusive">Already include tax</option>
                      <option value="exclusive">Exclude tax (added at checkout)</option>
                    </Select>
                  </Field>
                </div>
                <p className="text-charcoal-500 text-xs">
                  Tax is calculated on the subtotal plus service charge, rounded once per order.
                </p>
              </fieldset>

              <fieldset className="border-ivory-200 grid gap-4 border-t pt-4 sm:grid-cols-3">
                <legend className="text-sm font-semibold">Operations</legend>
                <Field label="Table session ends after (min idle)" htmlFor="tableSessionIdleMinutes">
                  <Input
                    id="tableSessionIdleMinutes"
                    name="tableSessionIdleMinutes"
                    type="number"
                    min={15}
                    max={1440}
                    defaultValue={s.tableSessionIdleMinutes}
                  />
                </Field>
                <Field label="Flag kitchen tickets late after (min)" htmlFor="kitchenDelayWarningMinutes">
                  <Input
                    id="kitchenDelayWarningMinutes"
                    name="kitchenDelayWarningMinutes"
                    type="number"
                    min={1}
                    max={240}
                    defaultValue={s.kitchenDelayWarningMinutes}
                  />
                </Field>
                <Field label="Max quantity per item" htmlFor="maxItemQuantity">
                  <Input
                    id="maxItemQuantity"
                    name="maxItemQuantity"
                    type="number"
                    min={1}
                    max={100}
                    defaultValue={s.maxItemQuantity}
                  />
                </Field>
              </fieldset>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Receipt header" htmlFor="receiptHeader" hint="Optional, for printed bills">
                  <Input id="receiptHeader" name="receiptHeader" defaultValue={s.receiptHeader ?? ""} maxLength={200} />
                </Field>
                <Field label="Receipt footer" htmlFor="receiptFooter">
                  <Input id="receiptFooter" name="receiptFooter" defaultValue={s.receiptFooter ?? ""} maxLength={200} />
                </Field>
              </div>
            </ActionForm>
          </div>
        </Card>
      </div>
    </>
  );
}
