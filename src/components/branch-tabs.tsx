import Link from "next/link";
import { cn } from "@/lib/cn";

/** Branch switcher rendered as links (?branch=…). Hidden when there is only one branch. */
export function BranchTabs({
  branches,
  current,
  hrefFor,
}: {
  branches: { id: string; name: string }[];
  current: string;
  hrefFor: (id: string) => string;
}) {
  if (branches.length < 2) return null;
  return (
    <nav aria-label="Branch" className="border-ivory-200 mb-5 flex flex-wrap gap-1 border-b">
      {branches.map((b) => (
        <Link
          key={b.id}
          href={hrefFor(b.id)}
          aria-current={b.id === current ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
            b.id === current
              ? "border-forest-700 text-forest-800"
              : "text-charcoal-500 hover:text-charcoal-900 border-transparent",
          )}
        >
          {b.name}
        </Link>
      ))}
    </nav>
  );
}

/** Picks the requested branch if accessible, else the first accessible one. */
export function pickBranch<T extends { id: string }>(branches: T[], requested?: string | null): T | null {
  return branches.find((b) => b.id === requested) ?? branches[0] ?? null;
}
