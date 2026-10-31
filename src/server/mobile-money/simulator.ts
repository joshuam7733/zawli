// Local simulator for MTN MoMo / Airtel Money. NEVER moves money.
// Behaviour depends on the last digits of the payer's number:
//   …000  → declined by the payer (FAILED)
//   …999  → never answered (stays PENDING until the order times out)
//   other → approved about 5 seconds after the request
import type { MobileMoneyProvider } from "@/generated/prisma/enums";
import type { CollectRequest, IntentRef, MobileMoneyClient, ProviderStatus } from "./types";

export const SIMULATED_APPROVAL_MS = 5_000;

export class SimulatorClient implements MobileMoneyClient {
  readonly environment = "SIMULATOR" as const;
  constructor(readonly provider: MobileMoneyProvider) {}

  async testConnection() {}

  async requestPayment(_req: CollectRequest) {}

  async getStatus(intent: IntentRef, now = Date.now()): Promise<ProviderStatus> {
    if (intent.msisdn.endsWith("000")) return { status: "FAILED", reason: "The payment was declined on the phone." };
    if (intent.msisdn.endsWith("999")) return { status: "PENDING" };
    if (now - intent.createdAt.getTime() < SIMULATED_APPROVAL_MS) return { status: "PENDING" };
    return { status: "SUCCESSFUL", transactionId: `SIM-${intent.reference.slice(-10).toUpperCase()}` };
  }
}
