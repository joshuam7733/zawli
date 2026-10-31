import type { MobileMoneyAccount } from "@/generated/prisma/client";
import { decryptJson } from "../secrets";
import { AirtelMoneyClient } from "./airtel";
import { MtnMomoClient } from "./mtn";
import { SimulatorClient } from "./simulator";
import { ProviderError, type AirtelCredentials, type MobileMoneyClient, type MtnCredentials } from "./types";

export * from "./types";

/**
 * The simulator never moves money, so it is allowed only in development, for demo
 * restaurants, or on a local test install started with MOBILE_MONEY_SIMULATOR=allow
 * (set by the "Start Zawli" launcher). Never set that variable on a real server.
 */
export function simulatorAllowed(tenantIsDemo: boolean): boolean {
  return process.env.NODE_ENV !== "production" || tenantIsDemo || process.env.MOBILE_MONEY_SIMULATOR === "allow";
}

/**
 * Builds the client for a restaurant's provider account. The simulator is refused
 * in production unless the restaurant is a demo, so a real restaurant can never
 * "receive" simulated money.
 */
export function clientFor(
  account: Pick<MobileMoneyAccount, "provider" | "environment" | "credentialsEnc">,
  tenantIsDemo: boolean,
): MobileMoneyClient {
  if (account.environment === "SIMULATOR") {
    if (!simulatorAllowed(tenantIsDemo)) {
      throw new ProviderError(
        "Simulator disabled in production",
        "Mobile money is not set up for this restaurant yet.",
      );
    }
    return new SimulatorClient(account.provider);
  }
  if (!account.credentialsEnc)
    throw new ProviderError("Missing credentials", "Mobile money is not set up for this restaurant yet.");
  if (account.provider === "MTN_MOMO")
    return new MtnMomoClient(account.environment, decryptJson<MtnCredentials>(account.credentialsEnc));
  return new AirtelMoneyClient(account.environment, decryptJson<AirtelCredentials>(account.credentialsEnc));
}
