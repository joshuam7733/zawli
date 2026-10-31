import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { platformRoleHasPermission } from "@/domain/permissions";
import { db } from "@/server/db";
import { requirePlatformPage } from "@/server/session";
import { PageHeader } from "@/components/ui";
import { CreateTenantForm } from "./create-tenant-form";

export const metadata: Metadata = { title: "New restaurant" };

export default async function NewTenantPage() {
  const { user } = await requirePlatformPage("platform.tenants.view");
  if (!platformRoleHasPermission(user?.platformRole, "platform.tenants.manage")) notFound();
  const plans = await db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { priceMinor: "asc" } });
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/tenants" className="text-forest-700 hover:underline">
          ← Restaurants
        </Link>
      </p>
      <PageHeader
        title="New restaurant"
        description="Creates the restaurant in onboarding, its first branch and kitchen station, the owner account and the subscription. It goes live once the checklist is complete."
      />
      <CreateTenantForm
        plans={plans.map((p) => ({
          id: p.id,
          label: `${p.name} — ${p.currency} ${p.priceMinor.toLocaleString("en")} / ${p.billingInterval === "MONTHLY" ? "month" : "year"}`,
        }))}
      />
    </>
  );
}
