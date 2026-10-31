import { afterEach, describe, expect, it, vi } from "vitest";
import { maskPhone, normalizeUgPhone } from "@/domain/phone";
import { decryptJson, encryptJson } from "@/server/secrets";
import { MtnMomoClient } from "@/server/mobile-money/mtn";
import { AirtelMoneyClient } from "@/server/mobile-money/airtel";
import { SimulatorClient } from "@/server/mobile-money/simulator";
import { canTransitionOrder, forwardPath } from "@/domain/order-status";

describe("Ugandan mobile money numbers", () => {
  it("normalises common formats", () => {
    for (const input of ["0772123456", "772123456", "+256772123456", "256 772 123 456", "0772-123-456"]) {
      expect(normalizeUgPhone(input, "MTN_MOMO")).toEqual({ ok: true, msisdn: "256772123456" });
    }
    expect(normalizeUgPhone("0752123456", "AIRTEL_MONEY")).toEqual({ ok: true, msisdn: "256752123456" });
  });

  it("rejects the wrong network and bad numbers", () => {
    expect(normalizeUgPhone("0752123456", "MTN_MOMO").ok).toBe(false);
    expect(normalizeUgPhone("0772123456", "AIRTEL_MONEY").ok).toBe(false);
    expect(normalizeUgPhone("12345", "MTN_MOMO").ok).toBe(false);
    expect(normalizeUgPhone("07721234ab", "MTN_MOMO").ok).toBe(false);
    expect(normalizeUgPhone("0412123456", "MTN_MOMO").ok).toBe(false);
  });

  it("masks numbers for display", () => {
    expect(maskPhone("256772123456")).toBe("0772 ••• 456");
  });
});

describe("credential encryption", () => {
  it("round-trips and hides the plaintext", () => {
    const enc = encryptJson({ apiKey: "super-secret" });
    expect(enc).not.toContain("super-secret");
    expect(decryptJson<{ apiKey: string }>(enc)).toEqual({ apiKey: "super-secret" });
  });

  it("rejects tampered data", () => {
    const enc = encryptJson({ a: 1 });
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptJson(parts.join("."))).toThrow();
  });
});

describe("order state with pay-first", () => {
  it("only lets an awaiting-payment order go to PLACED or CANCELLED", () => {
    expect(canTransitionOrder("PENDING_PAYMENT", "PLACED")).toBe(true);
    expect(canTransitionOrder("PENDING_PAYMENT", "CANCELLED")).toBe(true);
    expect(canTransitionOrder("PENDING_PAYMENT", "ACKNOWLEDGED")).toBe(false);
    expect(canTransitionOrder("PENDING_PAYMENT", "READY")).toBe(false);
  });

  it("never moves an unpaid order forward from kitchen activity", () => {
    expect(forwardPath("PENDING_PAYMENT", "READY")).toEqual([]);
    expect(forwardPath("PENDING_PAYMENT", "PLACED")).toEqual([]);
  });
});

describe("simulator", () => {
  const sim = new SimulatorClient("MTN_MOMO");
  const at = new Date("2026-10-20T10:00:00Z");
  it("approves after a few seconds, declines …000, never answers …999", async () => {
    const base = { reference: "r1", currency: "UGX", createdAt: at };
    expect(await sim.getStatus({ ...base, msisdn: "256772123456" }, at.getTime() + 1000)).toEqual({
      status: "PENDING",
    });
    expect((await sim.getStatus({ ...base, msisdn: "256772123456" }, at.getTime() + 6000)).status).toBe("SUCCESSFUL");
    expect((await sim.getStatus({ ...base, msisdn: "256772123000" }, at.getTime() + 6000)).status).toBe("FAILED");
    expect((await sim.getStatus({ ...base, msisdn: "256772123999" }, at.getTime() + 600_000)).status).toBe("PENDING");
  });
});

type Call = { url: string; init: RequestInit };
function mockFetch(responses: { match: RegExp; status: number; body: unknown }[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const r = responses.find((x) => x.match.test(url));
      if (!r) throw new Error(`unexpected ${url}`);
      return new Response(r.body === null ? null : JSON.stringify(r.body), { status: r.status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("MTN MoMo client", () => {
  const creds = { subscriptionKey: "sub-key", apiUser: "user-1", apiKey: "key-1", targetEnvironment: "mtnuganda" };

  it("requests to pay with the right headers and body (live)", async () => {
    const calls = mockFetch([
      { match: /collection\/token/, status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { match: /requesttopay$/, status: 202, body: null },
    ]);
    const client = new MtnMomoClient("PRODUCTION", { ...creds, apiUser: "user-live" });
    await client.requestPayment({
      reference: "11111111-2222-4333-8444-555555555555",
      amountMinor: 35000,
      currency: "UGX",
      msisdn: "256772123456",
      description: "Kampala Grill order 0042",
      callbackUrl: "https://zawli.example/api/public/payments/callback?ref=x",
    });
    const token = calls[0];
    expect(token.url).toBe("https://proxy.momoapi.mtn.com/collection/token/");
    expect((token.init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from("user-live:key-1").toString("base64")}`,
    );
    const pay = calls[1];
    const h = pay.init.headers as Record<string, string>;
    expect(h["X-Reference-Id"]).toBe("11111111-2222-4333-8444-555555555555");
    expect(h["X-Target-Environment"]).toBe("mtnuganda");
    expect(h["X-Callback-Url"]).toContain("https://");
    expect(JSON.parse(pay.init.body as string)).toMatchObject({
      amount: "35000",
      currency: "UGX",
      payer: { partyIdType: "MSISDN", partyId: "256772123456" },
    });
  });

  it("uses EUR and the sandbox target in the sandbox", async () => {
    const calls = mockFetch([
      { match: /collection\/token/, status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { match: /requesttopay$/, status: 202, body: null },
    ]);
    await new MtnMomoClient("SANDBOX", { ...creds, apiUser: "user-sbx" }).requestPayment({
      reference: "r",
      amountMinor: 1000,
      currency: "UGX",
      msisdn: "46733123454",
      description: "x",
    });
    expect((calls[1].init.headers as Record<string, string>)["X-Target-Environment"]).toBe("sandbox");
    expect(JSON.parse(calls[1].init.body as string).currency).toBe("EUR");
  });

  it("maps statuses", async () => {
    mockFetch([
      { match: /collection\/token/, status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { match: /requesttopay\/ok/, status: 200, body: { status: "SUCCESSFUL", financialTransactionId: "123456" } },
      { match: /requesttopay\/no/, status: 200, body: { status: "FAILED", reason: "NOT_ENOUGH_FUNDS" } },
      { match: /requesttopay\/wait/, status: 200, body: { status: "PENDING" } },
    ]);
    const c = new MtnMomoClient("PRODUCTION", { ...creds, apiUser: "user-status" });
    const base = { msisdn: "256772123456", currency: "UGX", createdAt: new Date() };
    expect(await c.getStatus({ ...base, reference: "ok" })).toEqual({ status: "SUCCESSFUL", transactionId: "123456" });
    expect(await c.getStatus({ ...base, reference: "no" })).toEqual({
      status: "FAILED",
      reason: "Not enough money on the MoMo account.",
    });
    expect(await c.getStatus({ ...base, reference: "wait" })).toEqual({ status: "PENDING" });
  });

  it("reports a rejected request", async () => {
    mockFetch([
      { match: /collection\/token/, status: 200, body: { access_token: "tok", expires_in: 3600 } },
      { match: /requesttopay$/, status: 400, body: { code: "PAYER_NOT_FOUND" } },
    ]);
    await expect(
      new MtnMomoClient("PRODUCTION", { ...creds, apiUser: "user-rej" }).requestPayment({
        reference: "r",
        amountMinor: 1,
        currency: "UGX",
        msisdn: "256772123456",
        description: "x",
      }),
    ).rejects.toMatchObject({ name: "ProviderError" });
  });
});

describe("Airtel Money client", () => {
  const creds = { clientId: "cid", clientSecret: "secret", country: "UG" };

  it("collects with the local msisdn and country headers", async () => {
    const calls = mockFetch([
      { match: /oauth2\/token/, status: 200, body: { access_token: "tok", expires_in: 180 } },
      {
        match: /merchant\/v1\/payments/,
        status: 200,
        body: { data: { transaction: { id: "ZWABC", status: "Success." } }, status: { success: true } },
      },
    ]);
    await new AirtelMoneyClient("PRODUCTION", creds).requestPayment({
      reference: "ZWABC",
      amountMinor: 35000,
      currency: "UGX",
      msisdn: "256752123456",
      description: "Kampala Grill order 0042",
    });
    expect(calls[0].url).toBe("https://openapi.airtel.africa/auth/oauth2/token");
    const pay = calls[1];
    const h = pay.init.headers as Record<string, string>;
    expect(h["X-Country"]).toBe("UG");
    expect(h["X-Currency"]).toBe("UGX");
    expect(JSON.parse(pay.init.body as string)).toMatchObject({
      subscriber: { msisdn: "752123456", country: "UG", currency: "UGX" },
      transaction: { amount: 35000, id: "ZWABC" },
    });
  });

  it("maps TS / TF / TIP", async () => {
    mockFetch([
      { match: /oauth2\/token/, status: 200, body: { access_token: "tok2", expires_in: 180 } },
      {
        match: /payments\/ok/,
        status: 200,
        body: { data: { transaction: { status: "TS", airtel_money_id: "MP123" } } },
      },
      {
        match: /payments\/no/,
        status: 200,
        body: { data: { transaction: { status: "TF", message: "Insufficient funds" } } },
      },
      { match: /payments\/wait/, status: 200, body: { data: { transaction: { status: "TIP" } } } },
    ]);
    const c = new AirtelMoneyClient("SANDBOX", { ...creds, clientId: "cid-status" });
    const base = { msisdn: "256752123456", currency: "UGX", createdAt: new Date() };
    expect(await c.getStatus({ ...base, reference: "ok" })).toEqual({ status: "SUCCESSFUL", transactionId: "MP123" });
    expect((await c.getStatus({ ...base, reference: "no" })).status).toBe("FAILED");
    expect(await c.getStatus({ ...base, reference: "wait" })).toEqual({ status: "PENDING" });
  });
});
