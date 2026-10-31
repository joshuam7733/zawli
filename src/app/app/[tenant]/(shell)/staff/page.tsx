import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, Checkbox, Field, PageHeader, Select } from "@/components/ui";
import { assignableRoles, ROLE_LABELS } from "@/domain/permissions";
import { can } from "@/server/authz";
import { db } from "@/server/db";
import { requireTenantPage } from "@/server/session";
import { listStaff } from "@/server/services/staff";
import { formatDateTime } from "@/lib/format";
import { inviteStaffAction, reissueLinkAction, setStaffActiveAction, updateStaffAction } from "./actions";
import { InviteForm, ReissueLink } from "./staff-forms";

export const metadata: Metadata = { title: "Staff" };

export default async function StaffPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant: slug } = await params;
  const ctx = await requireTenantPage(slug);
  if (!can(ctx, "staff.manage")) notFound();
  const [staff, branches] = await Promise.all([
    listStaff(ctx),
    db.branch.findMany({
      where: { tenantId: ctx.tenant.id, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const roles = assignableRoles(ctx.membership.role).map((r) => ({ value: r, label: ROLE_LABELS[r] }));
  const writable = ctx.tenant.status !== "SUSPENDED";

  return (
    <>
      <PageHeader
        title="Staff"
        description="Everyone signs in with their own account. Access is limited to their role and branches."
      />
      {writable ? (
        <Card className="mb-6">
          <CardHeader
            title="Add a staff member"
            description="You'll get a one-time setup link to send them. No email is sent automatically."
          />
          <div className="px-5 py-5">
            <InviteForm action={inviteStaffAction.bind(null, slug)} roles={roles} branches={branches} />
          </div>
        </Card>
      ) : null}
      <Card>
        <CardHeader title={`Team (${staff.filter((s) => s.isActive).length} active)`} />
        <ul className="divide-ivory-200 divide-y">
          {staff.map((m) => {
            const manageable =
              writable &&
              m.role !== "RESTAURANT_OWNER" &&
              m.user.id !== ctx.user.id &&
              assignableRoles(ctx.membership.role).includes(m.role);
            return (
              <li
                key={m.id}
                className={`flex flex-wrap items-start gap-x-6 gap-y-3 px-5 py-4 ${m.isActive ? "" : "opacity-60"}`}
              >
                <div className="min-w-56 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {m.user.name}
                    <Badge tone={m.role === "RESTAURANT_OWNER" ? "forest" : "neutral"}>{ROLE_LABELS[m.role]}</Badge>
                    {!m.isActive ? <Badge tone="danger">Deactivated</Badge> : null}
                    {!m.user.hasPassword ? <Badge tone="warning">Setup pending</Badge> : null}
                    {m.user.id === ctx.user.id ? <Badge tone="info">You</Badge> : null}
                  </p>
                  <p className="text-charcoal-500 text-sm">{m.user.email}</p>
                  <p className="text-charcoal-500 mt-1 text-xs">
                    {m.allBranches
                      ? "All branches"
                      : m.branches
                          .map((b) => `${b.name}${b.role !== m.role ? ` (${ROLE_LABELS[b.role]})` : ""}`)
                          .join(", ") || "No branches"}
                    {" · "}
                    {m.user.lastLoginAt
                      ? `last signed in ${formatDateTime(m.user.lastLoginAt, ctx.tenant.timezone, ctx.tenant.locale)}`
                      : "never signed in"}
                  </p>
                </div>
                {manageable ? (
                  <div className="flex flex-wrap items-start gap-1">
                    <details className="relative">
                      <summary className="text-charcoal-700 hover:bg-ivory-100 cursor-pointer list-none rounded-md px-3 py-1.5 text-sm [&::-webkit-details-marker]:hidden">
                        Change access
                      </summary>
                      <div className="border-ivory-200 shadow-pop absolute right-0 z-20 mt-1 w-80 rounded-lg border bg-white p-4">
                        <ActionForm action={updateStaffAction.bind(null, slug)} submitLabel="Save access">
                          <input type="hidden" name="membershipId" value={m.id} />
                          <Field label="Role" htmlFor={`role-${m.id}`}>
                            <Select id={`role-${m.id}`} name="role" defaultValue={m.role}>
                              {roles.map((r) => (
                                <option key={r.value} value={r.value}>
                                  {r.label}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <fieldset className="flex flex-col gap-2">
                            <legend className="mb-1 text-sm font-medium">Branches</legend>
                            <Checkbox
                              name="allBranches"
                              defaultChecked={m.allBranches}
                              label="All branches (managers only)"
                            />
                            {branches.map((b) => (
                              <Checkbox
                                key={b.id}
                                name="branchId"
                                value={b.id}
                                defaultChecked={m.allBranches || m.branches.some((x) => x.id === b.id)}
                                label={b.name}
                              />
                            ))}
                          </fieldset>
                        </ActionForm>
                      </div>
                    </details>
                    {!m.user.hasPassword || m.isActive ? (
                      <ReissueLink action={reissueLinkAction.bind(null, slug)} membershipId={m.id} />
                    ) : null}
                    <ActionButton
                      action={setStaffActiveAction.bind(null, slug)}
                      fields={{ membershipId: m.id, active: String(!m.isActive) }}
                      variant="ghost"
                      confirm={
                        m.isActive
                          ? `Remove ${m.user.name}'s access to ${ctx.tenant.name}? They are signed out of this restaurant immediately.`
                          : undefined
                      }
                    >
                      {m.isActive ? "Deactivate" : "Reactivate"}
                    </ActionButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>
      <p className="text-charcoal-500 mt-4 text-xs">
        Owner accounts are managed by the platform team. Contact support to transfer ownership.
      </p>
    </>
  );
}
