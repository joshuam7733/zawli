// Encryption for provider credentials at rest (AES-256-GCM).
// Key: PAYMENT_SECRETS_KEY (32 random bytes, base64). In development only, a key
// is derived from BETTER_AUTH_SECRET when PAYMENT_SECRETS_KEY is not set.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.PAYMENT_SECRETS_KEY;
  if (raw) {
    const k = Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("PAYMENT_SECRETS_KEY must be 32 bytes, base64-encoded.");
    return k;
  }
  if (process.env.NODE_ENV === "production") throw new Error("PAYMENT_SECRETS_KEY is not set.");
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base) throw new Error("Set PAYMENT_SECRETS_KEY (or BETTER_AUTH_SECRET in development).");
  return Buffer.from(hkdfSync("sha256", base, "zawli", "payment-secrets-v1", 32));
}

/** Encrypts a JSON value → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptJson(value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(
    ".",
  );
}

export function decryptJson<T>(payload: string): T {
  const [v, iv, tag, ct] = payload.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const pt = Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}
