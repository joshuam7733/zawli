import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { Card, EmptyState } from "@/components/ui";
import { DemoBadge, TenantStatusBadge } from "@/components/status";
import { SignOutButton } from "@/components/sign-out";
import { ROLE_LABELS } from "@/domain/permissions";
import { db } from "@/server/db";
import { requireUserPage } from "@/server/session";

export const metadata: Metadata = { title: "Choose a workspace" };

export default async function AppHome() {
  const user = await requireUserPage();
  const memberships = await db.membership.findMany({
    where: { userId: user.id, isActive: true, tenant: { status: { not: "DEACTIVATED" } } },
    include: { tenant: true },
    orderBy: { tenant: { name: "asc" } },
  });
  if (!user.platformRole && memberships.length === 1) redirect(`/app/${memberships[0].tenant.slug}`);

  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col px-5 py-10">
      <div className="mb-10 flex items-center justify-between">
        <Wordmark className="text-2xl" />
        <SignOutButton />
      </div>
      <h1 className="font-display text-2xl font-semibold tracking-tight">Hello, {user.name.split(" ")[0]}</h1>
      <p className="text-charcoal-600 mt-1 text-sm">Choose where you want to work.</p>

      <div className="mt-6 flex flex-col gap-3">
        {user.platformRole ? (
          <Link href="/admin" className="group">
            <Card className="group-hover:border-forest-600/40 flex items-center gap-4 px-5 py-4 transition-colors">
              <ShieldCheck className="text-forest-700 size-5" aria-hidden />
              <div className="flex-1">
                <p className="font-semibold">Platform administration</p>
                <p className="text-charcoal-500 text-sm">Restaurants, plans, invoices and audit log</p>
              </div>
              <ChevronRight className="text-charcoal-400 size-4" aria-hidden />
            </Card>
          </Link>
        ) : null}
        {memberships.map((m) => (
          <Link key={m.id} href={`/app/${m.tenant.slug}`} className="group">
            <Card className="group-hover:border-forest-600/40 flex items-center gap-4 px-5 py-4 transition-colors">
              <span
                aria-hidden
                className="font-display grid size-10 shrink-0 place-items-center rounded-md text-lg font-bold text-white"
                style={{ background: m.tenant.brandPrimary }}
              >
                {m.tenant.name.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{m.tenant.name}</p>
                <p className="text-charcoal-500 flex flex-wrap items-center gap-2 text-sm">
                  {ROLE_LABELS[m.role]}
                  {m.tenant.status !== "ACTIVE" ? <TenantStatusBadge status={m.tenant.status} /> : null}
                  {m.tenant.isDemo ? <DemoBadge /> : null}
                </p>
              </div>
              <ChevronRight className="text-charcoal-400 size-4" aria-hidden />
            </Card>
          </Link>
        ))}
        {memberships.length === 0 && !user.platformRole ? (
          <Card>
            <EmptyState
              title="No restaurant access yet"
              description="Ask your restaurant owner or manager to add you to their team."
            />
          </Card>
        ) : null}
      </div>
    </main>
  );
}
