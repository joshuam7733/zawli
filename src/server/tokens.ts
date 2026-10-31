import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

/** Cryptographically random, URL-safe token. 18 bytes = 144 bits → 24 characters. */
export function randomToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export { randomUUID };

/** QR tokens: 144 random bits, base64url. Shape check before touching the database. */
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,64}$/;
export function isWellFormedToken(token: string): boolean {
  return QR_TOKEN_PATTERN.test(token);
}
