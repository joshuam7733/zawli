import Link from "next/link";
import { Menu } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { AppNav, type NavItem } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out";
import { DemoBadge } from "@/components/status";
import { Notice } from "@/components/ui";
import { ROLE_LABELS } from "@/domain/permissions";
import { can } from "@/server/authz";
import { requireTenantPage } from "@/server/session";

export default async function TenantShellLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  const base = `/app/${slug}`;

  const ops: NavItem[] = [];
  if (can(ctx, "reports.view")) ops.push({ href: base, label: "Dashboard", icon: "dashboard", exact: true });
  ops.push({ href: `${base}/orders`, label: "Orders", icon: "orders" });
  ops.push({ href: `${base}/kitchen`, label: "Kitchen display", icon: "kitchen" });
  if (can(ctx, "orders.serve") || can(ctx, "service.handle"))
    ops.push({ href: `${base}/floor`, label: "Floor & tables", icon: "floor" });

  const setup: NavItem[] = [];
  if (can(ctx, "menu.manage") || can(ctx, "menu.availability"))
    setup.push({ href: `${base}/menu`, label: "Menu", icon: "menu" });
  if (can(ctx, "tables.manage")) setup.push({ href: `${base}/tables`, label: "Tables & QR codes", icon: "tables" });
  if (can(ctx, "staff.manage")) setup.push({ href: `${base}/staff`, label: "Staff", icon: "staff" });
  if (can(ctx, "printing.manage") || can(ctx, "branch.manage"))
    setup.push({ href: `${base}/branches`, label: "Branches & kitchen", icon: "branches" });
  setup.push({ href: `${base}/printing`, label: "Print queue", icon: "printing" });

  const account: NavItem[] = [];
  if (can(ctx, "tenant.settings.manage"))
    account.push({ href: `${base}/settings`, label: "Restaurant settings", icon: "settings" });
  if (can(ctx, "tenant.billing.view"))
    account.push({ href: `${base}/billing`, label: "Subscription & invoices", icon: "billing" });
  if (can(ctx, "tenant.audit.view")) account.push({ href: `${base}/audit`, label: "Activity log", icon: "audit" });

  const groups = [
    { label: "Operations", items: ops },
    { label: "Setup", items: setup },
    { label: "Account", items: account },
  ];

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <div className="px-3">
        <Link href="/app" className="block">
          <Wordmark tone="light" className="text-xl" />
        </Link>
        <div className="mt-5 flex items-center gap-3">
          <span
            aria-hidden
            className="font-display grid size-9 shrink-0 place-items-center rounded-md text-base font-bold text-white ring-1 ring-white/10"
            style={{ background: ctx.tenant.brandPrimary }}
          >
            {ctx.tenant.name.slice(0, 1)}
          </span>
          <div className="min-w-0">
            <p className="text-ivory-50 truncate text-sm font-semibold">{ctx.tenant.name}</p>
            <p className="text-ivory-200/60 text-xs">{ROLE_LABELS[ctx.membership.role]}</p>
          </div>
        </div>
        {ctx.tenant.isDemo ? <DemoBadge /> : null}
      </div>
      <div className="flex-1 overflow-y-auto">
        <AppNav groups={groups} />
      </div>
      <div className="border-t border-white/10 px-3 pt-4">
        <p className="text-ivory-200/60 truncate text-xs">{ctx.user.email}</p>
        <SignOutButton className="text-ivory-200/80 hover:bg-forest-800 hover:text-ivory-50 -mx-2.5 mt-1" />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[256px_minmax(0,1fr)]">
      <aside className="no-print bg-forest-900 sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>

      {/* Mobile top bar with a no-JS drawer */}
      <details className="no-print group bg-forest-900 sticky top-0 z-30 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-3">
            <Wordmark tone="light" className="text-lg" />
            <span className="text-ivory-200/80 truncate text-sm">{ctx.tenant.name}</span>
          </span>
          <Menu className="text-ivory-50 size-5" aria-label="Open menu" />
        </summary>
        <div className="max-h-[80dvh] overflow-y-auto border-t border-white/10">{sidebar}</div>
      </details>

      <div className="min-w-0">
        {ctx.tenant.status === "SUSPENDED" ? (
          <div className="no-print px-4 pt-4 sm:px-8">
            <Notice tone="warning" title="This restaurant account is suspended">
              You can view and export your data, but changes and customer ordering are paused. Please contact the
              platform administrator.
            </Notice>
          </div>
        ) : ctx.tenant.status === "ONBOARDING" ? (
          <div className="no-print px-4 pt-4 sm:px-8">
            <Notice tone="info" title="Setting up">
              Customers cannot order yet. Finish the setup checklist on the dashboard; the platform team will then
              switch your restaurant live.
            </Notice>
          </div>
        ) : null}
        <main className="px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
    </div>
  );
}
