import Link from "next/link";
import { Menu } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { AppNav, type NavItem } from "@/components/app-nav";
import { SignOutButton } from "@/components/sign-out";
import { platformRoleHasPermission } from "@/domain/permissions";
import { requirePlatformPage } from "@/server/session";

const ROLE = {
  SUPER_ADMIN: "Super admin",
  PLATFORM_BILLING: "Billing",
  PLATFORM_SUPPORT: "Support (read-only)",
} as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePlatformPage("platform.tenants.view");
  const role = ctx.user.platformRole;
  const items: NavItem[] = [
    { href: "/admin", label: "Overview", icon: "dashboard", exact: true },
    { href: "/admin/tenants", label: "Restaurants", icon: "branches" },
  ];
  if (platformRoleHasPermission(role, "platform.billing.view"))
    items.push({ href: "/admin/invoices", label: "Invoices", icon: "billing" });
  items.push({ href: "/admin/plans", label: "Plans", icon: "reports" });
  if (platformRoleHasPermission(role, "platform.audit.view"))
    items.push({ href: "/admin/audit", label: "Audit log", icon: "audit" });

  const sidebar = (
    <div className="flex h-full flex-col gap-6 px-3 py-5">
      <div className="px-3">
        <Link href="/admin">
          <Wordmark tone="light" className="text-xl" />
        </Link>
        <p className="mt-2 text-xs font-semibold tracking-wider text-lime-400 uppercase">Platform</p>
      </div>
      <div className="flex-1">
        <AppNav groups={[{ label: "Administration", items }]} />
      </div>
      <div className="border-t border-white/10 px-3 pt-4">
        <p className="text-ivory-200/60 truncate text-xs">
          {ctx.user.email} · {ROLE[role]}
        </p>
        <Link href="/app" className="text-ivory-200/80 hover:text-ivory-50 mt-1 block text-xs">
          Switch workspace
        </Link>
        <SignOutButton className="text-ivory-200/80 hover:bg-forest-800 hover:text-ivory-50 -mx-2.5 mt-1" />
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="no-print bg-charcoal-950 sticky top-0 hidden h-dvh lg:block">{sidebar}</aside>
      <details className="no-print group bg-charcoal-950 sticky top-0 z-30 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 [&::-webkit-details-marker]:hidden">
          <Wordmark tone="light" className="text-lg" />
          <Menu className="text-ivory-50 size-5" aria-label="Open menu" />
        </summary>
        <div className="border-t border-white/10">{sidebar}</div>
      </details>
      <main className="min-w-0 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
