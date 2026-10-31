// Mobile money phone numbers. Pure functions — no I/O.
import type { MobileMoneyProvider } from "@/generated/prisma/enums";

/** Uganda mobile prefixes (after 256 / leading 0). */
const UG_MTN = ["76", "77", "78", "79", "31", "39"];
const UG_AIRTEL = ["70", "74", "75", "20"];

export type PhoneCheck = { ok: true; msisdn: string } | { ok: false; error: string };

/**
 * Normalises a Ugandan number to international digits (2567XXXXXXXX) and checks
 * it belongs to the chosen network. Accepts 07…, 7…, +2567…, 2567… with spaces.
 */
export function normalizeUgPhone(input: string, provider: MobileMoneyProvider): PhoneCheck {
  const digits = input.replace(/[\s().-]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return { ok: false, error: "Enter your phone number using digits only." };
  let local: string;
  if (/^256\d{9}$/.test(digits)) local = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) local = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) local = digits;
  else return { ok: false, error: "Enter a 10-digit Ugandan number, e.g. 0772 123456." };

  const prefix = local.slice(0, 2);
  if (provider === "MTN_MOMO" && UG_AIRTEL.includes(prefix))
    return { ok: false, error: "That looks like an Airtel number. Choose Airtel Money, or enter an MTN number." };
  if (provider === "AIRTEL_MONEY" && UG_MTN.includes(prefix))
    return { ok: false, error: "That looks like an MTN number. Choose MTN MoMo, or enter an Airtel number." };
  if (![...UG_MTN, ...UG_AIRTEL].includes(prefix)) return { ok: false, error: "That isn't a Ugandan mobile number." };
  return { ok: true, msisdn: `256${local}` };
}

/** "256772123456" → "0772 ••• 456" for display to staff and guests. */
export function maskPhone(msisdn: string): string {
  const local = msisdn.startsWith("256") ? `0${msisdn.slice(3)}` : msisdn;
  if (local.length < 7) return "•••";
  return `${local.slice(0, 4)} ••• ${local.slice(-3)}`;
}

export const PROVIDER_LABEL: Record<MobileMoneyProvider, string> = {
  MTN_MOMO: "MTN MoMo",
  AIRTEL_MONEY: "Airtel Money",
};
