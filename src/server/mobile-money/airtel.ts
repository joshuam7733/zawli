// Airtel Money (Airtel Africa Open API) — Collections / USSD push.
// Docs: https://developers.airtel.africa
//   POST /auth/oauth2/token                   client_credentials → access token
//   POST /merchant/v1/payments/               prompt on payer's phone (msisdn WITHOUT country code)
//   GET  /standard/v1/payments/{id}           TS (success) | TF (failed) | TIP (in progress) | TA (ambiguous)
// Some Airtel merchant accounts additionally require request signing (x-signature /
// x-key); enable it in the Airtel portal only if Airtel asks you to — see docs.
import type { MobileMoneyEnvironment } from "@/generated/prisma/enums";
import {
  fetchJson,
  ProviderError,
  type AirtelCredentials,
  type CollectRequest,
  type IntentRef,
  type MobileMoneyClient,
  type ProviderStatus,
} from "./types";
import { currencyExponent } from "@/domain/money";

const BASE = {
  SANDBOX: "https://openapiuat.airtel.africa",
  PRODUCTION: "https://openapi.airtel.africa",
} as const;

const COUNTRY_CODE: Record<string, string> = { UG: "256", KE: "254", TZ: "255", RW: "250", ZM: "260", MW: "265" };

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class AirtelMoneyClient implements MobileMoneyClient {
  readonly provider = "AIRTEL_MONEY" as const;
  constructor(
    readonly environment: Exclude<MobileMoneyEnvironment, "SIMULATOR">,
    private readonly creds: AirtelCredentials,
  ) {}

  private get base() {
    return BASE[this.environment];
  }
  private get country() {
    return (this.creds.country || "UG").toUpperCase();
  }

  private async token(): Promise<string> {
    const cacheKey = `${this.environment}:${this.creds.clientId}`;
    const hit = tokenCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const { status, body } = await fetchJson(`${this.base}/auth/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "*/*" },
      body: JSON.stringify({
        client_id: this.creds.clientId,
        client_secret: this.creds.clientSecret,
        grant_type: "client_credentials",
      }),
    });
    const b = body as { access_token?: string; expires_in?: number | string } | null;
    if (status !== 200 || !b?.access_token) {
      throw new ProviderError(
        `Airtel token request failed (HTTP ${status})`,
        "Airtel Money is not set up correctly for this restaurant.",
      );
    }
    tokenCache.set(cacheKey, { token: b.access_token, expiresAt: Date.now() + Number(b.expires_in ?? 180) * 1000 });
    return b.access_token;
  }

  private headers(token: string, currency: string) {
    return {
      Authorization: `Bearer ${token}`,
      "X-Country": this.country,
      "X-Currency": currency,
      "Content-Type": "application/json",
      Accept: "*/*",
    };
  }

  async testConnection() {
    await this.token();
  }

  async requestPayment(req: CollectRequest) {
    const token = await this.token();
    const cc = COUNTRY_CODE[this.country] ?? "";
    const localMsisdn = cc && req.msisdn.startsWith(cc) ? req.msisdn.slice(cc.length) : req.msisdn;
    const exp = currencyExponent(req.currency);
    const { status, body } = await fetchJson(`${this.base}/merchant/v1/payments/`, {
      method: "POST",
      headers: this.headers(token, req.currency),
      body: JSON.stringify({
        reference: req.description.slice(0, 64),
        subscriber: { country: this.country, currency: req.currency, msisdn: localMsisdn },
        transaction: {
          amount: req.amountMinor / 10 ** exp,
          country: this.country,
          currency: req.currency,
          id: req.reference,
        },
      }),
    });
    const b = body as { status?: { success?: boolean; message?: string; response_code?: string } } | null;
    if (status !== 200 || b?.status?.success === false) {
      throw new ProviderError(
        `Airtel payment rejected (HTTP ${status}): ${b?.status?.response_code ?? ""} ${b?.status?.message ?? ""}`.trim(),
        "Airtel Money couldn't start the payment. Check the number and try again.",
      );
    }
  }

  async getStatus(intent: IntentRef): Promise<ProviderStatus> {
    const token = await this.token();
    const { status, body } = await fetchJson(`${this.base}/standard/v1/payments/${intent.reference}`, {
      headers: this.headers(token, intent.currency),
    });
    if (status === 404) return { status: "PENDING" };
    if (status !== 200) throw new ProviderError(`Airtel status check failed (HTTP ${status})`);
    const tx = (body as { data?: { transaction?: { status?: string; airtel_money_id?: string; message?: string } } })
      ?.data?.transaction;
    switch (tx?.status) {
      case "TS":
        return { status: "SUCCESSFUL", transactionId: tx.airtel_money_id ?? null };
      case "TF":
        return {
          status: "FAILED",
          reason: tx.message ? `The payment didn't go through (${tx.message}).` : "The payment didn't go through.",
        };
      default: // TIP (in progress) or TA (ambiguous): keep checking
        return { status: "PENDING" };
    }
  }
}
