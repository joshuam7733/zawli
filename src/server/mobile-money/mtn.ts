// MTN MoMo Collections API — RequestToPay.
// Docs: https://momodeveloper.mtn.com (Collection product).
//   POST /collection/token/                      Basic apiUser:apiKey + subscription key → access token
//   POST /collection/v1_0/requesttopay           202 Accepted; prompt on payer's phone
//   GET  /collection/v1_0/requesttopay/{refId}   PENDING | SUCCESSFUL | FAILED
// The sandbox only accepts currency EUR and uses X-Target-Environment "sandbox".
import type { MobileMoneyEnvironment } from "@/generated/prisma/enums";
import {
  fetchJson,
  ProviderError,
  type CollectRequest,
  type IntentRef,
  type MobileMoneyClient,
  type MtnCredentials,
  type ProviderStatus,
} from "./types";
import { currencyExponent } from "@/domain/money";

const BASE = {
  SANDBOX: "https://sandbox.momodeveloper.mtn.com",
  PRODUCTION: "https://proxy.momoapi.mtn.com",
} as const;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export class MtnMomoClient implements MobileMoneyClient {
  readonly provider = "MTN_MOMO" as const;
  constructor(
    readonly environment: Exclude<MobileMoneyEnvironment, "SIMULATOR">,
    private readonly creds: MtnCredentials,
  ) {}

  private get base() {
    return BASE[this.environment];
  }
  private get target() {
    return this.environment === "SANDBOX" ? "sandbox" : this.creds.targetEnvironment || "mtnuganda";
  }

  private async token(): Promise<string> {
    const cacheKey = `${this.environment}:${this.creds.apiUser}`;
    const hit = tokenCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
    const { status, body } = await fetchJson(`${this.base}/collection/token/`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${this.creds.apiUser}:${this.creds.apiKey}`).toString("base64")}`,
        "Ocp-Apim-Subscription-Key": this.creds.subscriptionKey,
      },
    });
    const b = body as { access_token?: string; expires_in?: number } | null;
    if (status !== 200 || !b?.access_token) {
      throw new ProviderError(
        `MTN token request failed (HTTP ${status})`,
        "MTN MoMo is not set up correctly for this restaurant.",
      );
    }
    tokenCache.set(cacheKey, { token: b.access_token, expiresAt: Date.now() + (b.expires_in ?? 3600) * 1000 });
    return b.access_token;
  }

  async testConnection() {
    await this.token();
  }

  async requestPayment(req: CollectRequest) {
    const token = await this.token();
    const exp = currencyExponent(req.currency);
    const amount = (req.amountMinor / 10 ** exp).toFixed(exp);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "X-Reference-Id": req.reference,
      "X-Target-Environment": this.target,
      "Ocp-Apim-Subscription-Key": this.creds.subscriptionKey,
      "Content-Type": "application/json",
    };
    // MTN only calls back to whitelisted HTTPS hosts; polling covers everything else.
    if (req.callbackUrl?.startsWith("https://")) headers["X-Callback-Url"] = req.callbackUrl;
    const { status, body } = await fetchJson(`${this.base}/collection/v1_0/requesttopay`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        amount,
        currency: this.environment === "SANDBOX" ? "EUR" : req.currency,
        externalId: req.reference,
        payer: { partyIdType: "MSISDN", partyId: req.msisdn },
        payerMessage: req.description.slice(0, 160),
        payeeNote: req.description.slice(0, 160),
      }),
    });
    if (status !== 202) {
      const msg = typeof body === "object" && body ? JSON.stringify(body).slice(0, 300) : String(body);
      throw new ProviderError(
        `MTN requesttopay rejected (HTTP ${status}): ${msg}`,
        "MTN MoMo couldn't start the payment. Check the number and try again.",
      );
    }
  }

  async getStatus(intent: IntentRef): Promise<ProviderStatus> {
    const token = await this.token();
    const { status, body } = await fetchJson(`${this.base}/collection/v1_0/requesttopay/${intent.reference}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Target-Environment": this.target,
        "Ocp-Apim-Subscription-Key": this.creds.subscriptionKey,
      },
    });
    if (status === 404) return { status: "PENDING" }; // not yet visible; keep checking
    if (status !== 200) throw new ProviderError(`MTN status check failed (HTTP ${status})`);
    const b = body as { status?: string; financialTransactionId?: string; reason?: unknown };
    if (b.status === "SUCCESSFUL") return { status: "SUCCESSFUL", transactionId: b.financialTransactionId ?? null };
    if (b.status === "FAILED") {
      const r = b.reason as { message?: string; code?: string } | string | undefined;
      return { status: "FAILED", reason: humanMtnReason(typeof r === "string" ? r : (r?.code ?? r?.message)) };
    }
    return { status: "PENDING" };
  }
}

function humanMtnReason(code: string | undefined): string {
  switch (code) {
    case "APPROVAL_REJECTED":
    case "PAYER_REJECTED":
      return "The payment was declined on the phone.";
    case "EXPIRED":
      return "The payment request expired before it was approved.";
    case "NOT_ENOUGH_FUNDS":
      return "Not enough money on the MoMo account.";
    case "PAYER_LIMIT_REACHED":
      return "The MoMo account has reached its limit.";
    case "PAYER_NOT_FOUND":
    case "PAYEE_NOT_FOUND":
      return "That number isn't registered for MTN MoMo.";
    default:
      return "The payment didn't go through.";
  }
}
