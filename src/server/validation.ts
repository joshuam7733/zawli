// Shared Zod building blocks.
import { z } from "zod";

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid identifier.");

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, "Use at least 3 characters.")
  .max(40)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers and single hyphens.")
  .refine((s) => !RESERVED_SLUGS.has(s), "This name is reserved. Choose another.");

const RESERVED_SLUGS = new Set([
  "admin",
  "app",
  "api",
  "login",
  "logout",
  "setup",
  "t",
  "www",
  "static",
  "public",
  "zawli",
]);

export const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #14532D.");

export const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code, e.g. UGX.")
  .refine((c) => {
    try {
      new Intl.NumberFormat("en", { style: "currency", currency: c });
      return true;
    } catch {
      return false;
    }
  }, "Unknown currency code.");

export const timezoneSchema = z
  .string()
  .trim()
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone. Use an IANA name such as Africa/Kampala.");

export const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, "Use a 2-letter country code, e.g. UG.");

export const localeSchema = z
  .string()
  .trim()
  .refine((l) => {
    try {
      return Intl.NumberFormat.supportedLocalesOf([l]).length > 0;
    } catch {
      return false;
    }
  }, "Unsupported locale.");

export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const phoneSchema = z
  .string()
  .trim()
  .max(32)
  .regex(/^[+0-9 ()-]*$/, "Use digits, spaces and + only.")
  .optional()
  .nullable()
  .transform((v) => (v ? v : null));

/** Basis points from a percentage string or number (12.5 → 1250). */
export const percentBpsSchema = z.coerce
  .number()
  .min(0, "Must be 0 or more.")
  .max(100, "Must be 100 or less.")
  .transform((p) => Math.round(p * 100));

/** Integer minor-unit money amount. */
export const minorAmountSchema = z.coerce.number().int("Invalid amount.").min(0).max(1_000_000_000_000);

export const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean(), z.undefined(), z.null(), z.literal("")])
  .transform((v) => v === true || v === "on" || v === "true");
