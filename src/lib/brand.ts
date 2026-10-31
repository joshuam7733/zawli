// Provisional brand. Change NEXT_PUBLIC_BRAND_NAME (and this file) if name
// clearance requires it — nothing else in the codebase hardcodes the name.
export const BRAND = {
  name: process.env.NEXT_PUBLIC_BRAND_NAME || "Zawli",
  tagline: "Every table. Every order. One system.",
  supportEmail: "support@example.com",
} as const;
