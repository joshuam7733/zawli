// Common interface for mobile money collection providers (MTN MoMo, Airtel Money).
import type { MobileMoneyEnvironment, MobileMoneyProvider } from "@/generated/prisma/enums";

export interface CollectRequest {
  /** Our unique reference for this attempt (sent to the provider, used for status checks). */
  reference: string;
  amountMinor: number;
  currency: string;
  /** International digits, e.g. 256772123456. */
  msisdn: string;
  /** Short text shown to the payer, e.g. "Kampala Grill order 0042". */
  description: string;
  /** Optional HTTPS URL the provider may call when the status changes. */
  callbackUrl?: string;
}

export type ProviderStatus =
  { status: "PENDING" } | { status: "SUCCESSFUL"; transactionId: string | null } | { status: "FAILED"; reason: string };

/** What a status check needs to know about an earlier request. */
export interface IntentRef {
  reference: string;
  msisdn: string;
  currency: string;
  createdAt: Date;
}

export interface MobileMoneyClient {
  readonly provider: MobileMoneyProvider;
  readonly environment: MobileMoneyEnvironment;
  /** Pushes a payment prompt to the payer's phone. Throws ProviderError on rejection. */
  requestPayment(req: CollectRequest): Promise<void>;
  /** Asks the provider for the current status. Never trust callbacks — always use this. */
  getStatus(intent: IntentRef): Promise<ProviderStatus>;
  /** Verifies credentials by obtaining an access token. */
  testConnection(): Promise<void>;
}

export interface MtnCredentials {
  subscriptionKey: string;
  apiUser: string;
  apiKey: string;
  /** X-Target-Environment in production, e.g. "mtnuganda". Ignored in the sandbox. */
  targetEnvironment?: string;
}

export interface AirtelCredentials {
  clientId: string;
  clientSecret: string;
  /** ISO country, default UG. */
  country?: string;
}

export class ProviderError extends Error {
  /** Safe to show to the guest. */
  readonly publicMessage: string;
  constructor(message: string, publicMessage = "The payment couldn't be started. Please try again.") {
    super(message);
    this.name = "ProviderError";
    this.publicMessage = publicMessage;
  }
}

/** fetch with a timeout and JSON parsing; never logs secrets. */
export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<{ status: number; body: unknown }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
  } catch (e) {
    throw new ProviderError(
      `Network error calling ${new URL(url).host}: ${(e as Error).message}`,
      "The payment service is not responding. Please try again.",
    );
  }
  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}
