import Link from "next/link";
import { ChefHat, ConciergeBell, QrCode, ShieldCheck } from "lucide-react";
import { PatternBand, Wordmark } from "@/components/brand";
import { buttonClass } from "@/components/ui";
import { BRAND } from "@/lib/brand";

const FEATURES = [
  {
    icon: QrCode,
    title: "QR ordering at the table",
    body: "Guests scan, browse your menu and order from their phone. No app, no account.",
  },
  {
    icon: ChefHat,
    title: "Kitchen display or printer",
    body: "Orders reach the right station on a screen, as printed tickets, or both.",
  },
  {
    icon: ConciergeBell,
    title: "Floor service",
    body: "Waiters see ready orders, waiter calls and bill requests as they happen.",
  },
  {
    icon: ShieldCheck,
    title: "Built for many restaurants",
    body: "Every restaurant's data is isolated, with branch-level staff permissions.",
  },
];

export default function Landing() {
  return (
    <div className="bg-ivory-50 min-h-dvh">
      <header className="bg-forest-900 text-ivory-50 relative overflow-hidden">
        <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <Wordmark tone="light" className="text-2xl" />
          <Link href="/login" className={buttonClass("accent", "md")}>
            Sign in
          </Link>
        </div>
        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-12 pb-24 sm:px-8 sm:pt-20 sm:pb-32">
          <p className="mb-4 text-sm font-semibold tracking-wider text-lime-400 uppercase">
            Restaurant operations, Kampala-built
          </p>
          <h1 className="font-display max-w-3xl text-4xl leading-[1.05] font-semibold tracking-tight sm:text-6xl">
            {BRAND.tagline}
          </h1>
          <p className="text-ivory-200/85 mt-6 max-w-xl text-lg">
            {BRAND.name} connects your tables, kitchen and floor staff — from a single café to a group with several
            branches.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className={buttonClass("accent", "lg")}>
              Sign in to your restaurant
            </Link>
          </div>
        </div>
        <PatternBand className="absolute inset-x-0 bottom-0 h-16 w-full text-lime-400" opacity={0.16} />
      </header>

      <main className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <li key={f.title} className="border-forest-800 border-t-2 pt-5">
              <f.icon className="text-forest-700 size-6" aria-hidden />
              <h2 className="text-charcoal-950 mt-3 font-semibold">{f.title}</h2>
              <p className="text-charcoal-600 mt-1.5 text-sm">{f.body}</p>
            </li>
          ))}
        </ul>
        <p className="text-charcoal-500 mt-16 text-sm">
          Pay at the restaurant: cash, mobile money and card/POS payments are recorded by your staff. Restaurants are
          onboarded by our team — get in touch to start.
        </p>
      </main>
      <footer className="border-ivory-200 border-t">
        <div className="text-charcoal-500 mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-6 text-xs sm:px-8">
          <span>
            © {new Date().getFullYear()} {BRAND.name} (working name)
          </span>
          <span>Made for restaurants in Uganda and beyond.</span>
        </div>
      </footer>
    </div>
  );
}
