"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  ChefHat,
  ClipboardList,
  CreditCard,
  Grid2x2,
  History,
  LayoutDashboard,
  Printer,
  Settings,
  UtensilsCrossed,
  Users,
  ConciergeBell,
} from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = {
  dashboard: LayoutDashboard,
  orders: ClipboardList,
  kitchen: ChefHat,
  floor: ConciergeBell,
  menu: UtensilsCrossed,
  tables: Grid2x2,
  staff: Users,
  branches: Building2,
  printing: Printer,
  billing: CreditCard,
  audit: History,
  settings: Settings,
  reports: BarChart3,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  exact?: boolean;
}

export function AppNav({ groups }: { groups: { label: string; items: NavItem[] }[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-5">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label}>
            <p className="text-ivory-200/50 mb-1.5 px-3 text-[11px] font-semibold tracking-wider uppercase">
              {g.label}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = item.exact
                  ? pathname === item.href
                  : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-forest-700 text-ivory-50"
                          : "text-ivory-200/80 hover:bg-forest-800 hover:text-ivory-50",
                      )}
                    >
                      <Icon className={cn("size-4", active ? "text-lime-400" : "text-ivory-200/60")} aria-hidden />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
    </nav>
  );
}
