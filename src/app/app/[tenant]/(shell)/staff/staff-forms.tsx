"use client";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/server/action";
import { OneTimeSecret } from "@/components/action-form";
import { Button, Checkbox, Field, Input, Notice, Select } from "@/components/ui";

type LinkAction = (p: ActionResult, fd: FormData) => Promise<ActionResult<{ setupUrl: string | null }>>;

const ROLE_HELP: Record<string, string> = {
  MANAGER: "Runs daily operations: menu, tables, staff (waiters & kitchen), orders, payments and reports.",
  WAITER: "Floor screen: serves orders, handles waiter calls and bill requests, records payments.",
  KITCHEN: "Kitchen screen only: sees tickets, marks them ready, can mark items sold out. No money.",
};

export function InviteForm({
  action,
  roles,
  branches,
}: {
  action: LinkAction;
  roles: { value: string; label: string }[];
  branches: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{
    setupUrl: string | null;
  }>);
  const [role, setRole] = useState(roles[roles.length - 1]?.value ?? "WAITER");
  const [all, setAll] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const done = state.ok && state.data;
  // Clear the form after each successful invite (the link stays visible above it).
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    if (state.ok && state.data) setFormKey((k) => k + 1);
  }

  return (
    <div className="flex flex-col gap-4">
      {done ? (
        state.data!.setupUrl ? (
          <OneTimeSecret
            label="Setup link — share it privately (WhatsApp, SMS or in person)"
            value={state.data!.setupUrl}
            note="Works once and expires in 72 hours. It is not shown again; you can issue a new one from the staff list."
          />
        ) : (
          <Notice tone="forest">
            This person already has a password — they can sign in now and will see your restaurant.
          </Notice>
        )
      ) : null}
      <form key={formKey} action={formAction} className="flex flex-col gap-4">
        {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Full name" htmlFor="inv-name">
            <Input id="inv-name" name="name" required maxLength={80} autoComplete="off" />
          </Field>
          <Field label="Email" htmlFor="inv-email" hint="Used to sign in">
            <Input id="inv-email" name="email" type="email" required autoComplete="off" />
          </Field>
          <Field label="Role" htmlFor="inv-role">
            <Select id="inv-role" name="role" value={role} onChange={(e) => setRole(e.target.value)}>
              {roles.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <p className="text-charcoal-600 text-sm">{ROLE_HELP[role]}</p>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">Branches</legend>
          {role === "MANAGER" ? (
            <Checkbox
              name="allBranches"
              checked={all}
              onChange={(e) => setAll(e.target.checked)}
              label="All branches, including future ones"
            />
          ) : null}
          {!(role === "MANAGER" && all) ? (
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {branches.map((b) => (
                <Checkbox
                  key={b.id}
                  name="branchId"
                  value={b.id}
                  defaultChecked={branches.length === 1}
                  label={b.name}
                />
              ))}
            </div>
          ) : null}
        </fieldset>
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add staff member"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export function ReissueLink({ action, membershipId }: { action: LinkAction; membershipId: string }) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{
    setupUrl: string | null;
  }>);
  if (state.ok && state.data?.setupUrl)
    return (
      <OneTimeSecret
        label="New setup link"
        value={state.data.setupUrl}
        note="Older links for this person no longer work."
      />
    );
  return (
    <form action={formAction} className="inline-flex flex-col">
      <input type="hidden" name="membershipId" value={membershipId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Creating…" : "New setup link"}
      </Button>
      {!state.ok ? <span className="text-danger-700 text-xs">{state.error}</span> : null}
    </form>
  );
}
