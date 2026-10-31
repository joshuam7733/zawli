import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Checkbox, Field, Input, Notice, Select } from "@/components/ui";
import type { getMobileMoneySettings } from "@/server/services/mobile-money";
import { saveMobileMoneyAction, savePaymentTimingAction, testMobileMoneyAction } from "./mobile-money-actions";

type Settings = Awaited<ReturnType<typeof getMobileMoneySettings>>;

const LABEL = { MTN_MOMO: "MTN MoMo", AIRTEL_MONEY: "Airtel Money" } as const;
const ENV_LABEL = {
  SIMULATOR: "Simulator (testing, no real money)",
  SANDBOX: "Sandbox / UAT (provider test keys)",
  PRODUCTION: "Live",
} as const;

/** Pay-first rule + MTN MoMo / Airtel Money connection details. */
export function MobileMoneySettings({ slug, settings }: { slug: string; settings: Settings }) {
  const enabled = settings.accounts.filter((a) => a.isEnabled);
  const payFirstActive = settings.paymentTiming === "PAY_FIRST" && enabled.length > 0;
  return (
    <Card>
      <CardHeader
        title="Mobile money payments"
        description="Guests pay with MTN MoMo or Airtel Money before their order reaches the kitchen. Money goes straight to your own mobile money account."
        action={payFirstActive ? <Badge tone="forest">Pay first is on</Badge> : <Badge>Pay at the restaurant</Badge>}
      />
      <div className="flex flex-col gap-6 px-5 py-5">
        {settings.paymentTiming === "PAY_FIRST" && enabled.length === 0 ? (
          <Notice tone="warning">
            Turn on MTN MoMo or Airtel Money below. Until one is on, guests&apos; orders go to the kitchen without
            payment.
          </Notice>
        ) : null}

        <ActionForm action={savePaymentTimingAction.bind(null, slug)} submitLabel="Save payment rule">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="When do guests pay?" htmlFor="paymentTiming">
              <Select id="paymentTiming" name="paymentTiming" defaultValue={settings.paymentTiming}>
                <option value="PAY_FIRST">Before the kitchen starts (mobile money)</option>
                <option value="PAY_AFTER">At the restaurant, after eating</option>
              </Select>
            </Field>
            <Field
              label="Cancel unpaid orders after (minutes)"
              htmlFor="unpaidOrderTimeoutMinutes"
              hint="Unpaid orders never reach the kitchen."
            >
              <Input
                id="unpaidOrderTimeoutMinutes"
                name="unpaidOrderTimeoutMinutes"
                type="number"
                min={5}
                max={120}
                defaultValue={settings.unpaidOrderTimeoutMinutes}
              />
            </Field>
          </div>
        </ActionForm>

        {settings.accounts.map((a) => (
          <div key={a.provider} className="border-ivory-200 rounded-lg border p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{LABEL[a.provider]}</h3>
              {a.isEnabled ? <Badge tone="forest">On</Badge> : <Badge>Off</Badge>}
              {a.isEnabled && a.environment !== "PRODUCTION" ? <Badge tone="warning">Test mode</Badge> : null}
              {a.hasCredentials ? <Badge tone="info">API keys saved</Badge> : null}
              {a.hasCredentials || a.environment === "SIMULATOR" ? (
                <span className="ml-auto">
                  <ActionButton
                    action={testMobileMoneyAction.bind(null, slug)}
                    fields={{ provider: a.provider }}
                    variant="ghost"
                  >
                    Test connection
                  </ActionButton>
                </span>
              ) : null}
            </div>
            <ActionForm
              action={saveMobileMoneyAction.bind(null, slug)}
              submitLabel={`Save ${LABEL[a.provider]}`}
              submitVariant="secondary"
            >
              <input type="hidden" name="provider" value={a.provider} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Checkbox name="isEnabled" defaultChecked={a.isEnabled} label={`Accept ${LABEL[a.provider]}`} />
                <Field label="Environment" htmlFor={`env-${a.provider}`}>
                  <Select id={`env-${a.provider}`} name="environment" defaultValue={a.environment}>
                    {(["SIMULATOR", "SANDBOX", "PRODUCTION"] as const).map((e) => (
                      <option key={e} value={e}>
                        {ENV_LABEL[e]}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <p className="text-charcoal-500 text-xs">
                API details are stored encrypted and never shown again. Leave them blank to keep the saved ones.
              </p>
              {a.provider === "MTN_MOMO" ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Collection subscription key"
                    htmlFor="mtn-sub"
                    hint="From momodeveloper.mtn.com (Collections product)"
                  >
                    <Input id="mtn-sub" name="subscriptionKey" type="password" autoComplete="off" />
                  </Field>
                  <Field label="API user (UUID)" htmlFor="mtn-user">
                    <Input id="mtn-user" name="apiUser" type="password" autoComplete="off" />
                  </Field>
                  <Field label="API key" htmlFor="mtn-key">
                    <Input id="mtn-key" name="apiKey" type="password" autoComplete="off" />
                  </Field>
                  <Field
                    label="Target environment (live)"
                    htmlFor="mtn-target"
                    hint="Given by MTN when you go live, e.g. mtnuganda"
                  >
                    <Input id="mtn-target" name="targetEnvironment" autoComplete="off" placeholder="mtnuganda" />
                  </Field>
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Client ID" htmlFor="airtel-id" hint="From developers.airtel.africa">
                    <Input id="airtel-id" name="clientId" type="password" autoComplete="off" />
                  </Field>
                  <Field label="Client secret" htmlFor="airtel-secret">
                    <Input id="airtel-secret" name="clientSecret" type="password" autoComplete="off" />
                  </Field>
                  <Field label="Country" htmlFor="airtel-country">
                    <Input id="airtel-country" name="country" maxLength={2} placeholder="UG" autoComplete="off" />
                  </Field>
                </div>
              )}
            </ActionForm>
          </div>
        ))}
      </div>
    </Card>
  );
}
