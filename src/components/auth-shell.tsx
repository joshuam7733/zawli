import type { ReactNode } from "react";
import Link from "next/link";
import { PatternBand, Wordmark } from "./brand";
import { BRAND } from "@/lib/brand";

/** Split layout for sign-in and account setup. */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-forest-900 text-ivory-100 relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link href="/" className="relative z-10 w-fit">
          <Wordmark tone="light" className="text-3xl" />
        </Link>
        <div className="relative z-10 max-w-md">
          <p className="font-display text-ivory-50 text-4xl leading-[1.08] font-semibold tracking-tight">
            {BRAND.tagline}
          </p>
          <p className="text-ivory-200/80 mt-4 text-base">
            QR ordering, kitchen screens and floor service for restaurants, cafés and bars — one system for every
            branch.
          </p>
        </div>
        <PatternBand className="absolute inset-x-0 bottom-0 h-24 w-full text-lime-400" opacity={0.18} />
      </aside>
      <section className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 inline-block lg:hidden">
            <Wordmark className="text-3xl" />
          </Link>
          <h1 className="font-display text-charcoal-950 text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle ? <p className="text-charcoal-600 mt-1.5 text-sm">{subtitle}</p> : null}
          <div className="mt-8">{children}</div>
        </div>
      </section>
    </main>
  );
}
