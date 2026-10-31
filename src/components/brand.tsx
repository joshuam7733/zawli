import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/cn";

/**
 * Temporary text wordmark. The lime rhombus stands in for a mark until the name
 * is cleared; swap this component (and NEXT_PUBLIC_BRAND_NAME) to rebrand.
 */
export function Wordmark({ className, tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  return (
    <span
      className={cn(
        "font-display inline-flex items-baseline gap-[0.18em] leading-none font-bold tracking-[-0.04em] lowercase",
        tone === "dark" ? "text-forest-900" : "text-ivory-50",
        className,
      )}
      aria-label={BRAND.name}
    >
      <span aria-hidden>{BRAND.name.toLowerCase()}</span>
      <svg aria-hidden viewBox="0 0 10 10" className="h-[0.42em] w-[0.42em] translate-y-[-0.05em] self-center">
        <path d="M5 0 10 5 5 10 0 5Z" fill="var(--color-lime-400)" />
      </svg>
    </span>
  );
}

/**
 * Subtle geometric band inspired by contemporary East African textile rhythm
 * (stacked chevrons and rhombi). Decorative only — use sparingly.
 */
export function PatternBand({ className, opacity = 0.14 }: { className?: string; opacity?: number }) {
  return (
    <svg aria-hidden className={cn("pointer-events-none select-none", className)} preserveAspectRatio="none">
      <defs>
        <pattern id="zawli-band" width="48" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 24 12 12 24 24 36 12 48 24" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M24 0 30 6 24 12 18 6Z" fill="currentColor" />
          <path d="M0 0 6 6 0 12M48 0 42 6 48 12" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#zawli-band)" opacity={opacity} />
    </svg>
  );
}
