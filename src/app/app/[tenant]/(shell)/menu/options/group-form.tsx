"use client";
import { useState } from "react";
import type { ActionResult } from "@/server/action";
import { ActionForm } from "@/components/action-form";
import { Checkbox, Field, Input } from "@/components/ui";
import { RowsEditor } from "../variants-editor";

export function ModifierGroupForm({
  action,
  currency,
  group,
}: {
  action: (p: ActionResult, fd: FormData) => Promise<ActionResult>;
  currency: string;
  group?: {
    id: string;
    name: string;
    minSelect: number;
    maxSelect: number;
    options: { id: string; name: string; price: string; isAvailable: boolean }[];
  };
}) {
  const [required, setRequired] = useState((group?.minSelect ?? 0) > 0);
  const [formKey, setFormKey] = useState(0);
  return (
    <ActionForm
      key={formKey}
      action={action}
      submitLabel={group ? "Save group" : "Create group"}
      onSuccess={() => !group && setFormKey((k) => k + 1)}
    >
      {group ? <input type="hidden" name="groupId" value={group.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
        <Field label="Group name" htmlFor={`g-name-${group?.id ?? "new"}`}>
          <Input
            id={`g-name-${group?.id ?? "new"}`}
            name="name"
            required
            maxLength={60}
            defaultValue={group?.name}
            placeholder="e.g. Choose a side"
          />
        </Field>
        <Field label="Minimum" htmlFor={`g-min-${group?.id ?? "new"}`} hint={required ? undefined : "Optional group"}>
          <Input
            id={`g-min-${group?.id ?? "new"}`}
            name="minSelect"
            type="number"
            min={1}
            max={20}
            defaultValue={Math.max(1, group?.minSelect ?? 1)}
            disabled={!required}
          />
        </Field>
        <Field label="Maximum" htmlFor={`g-max-${group?.id ?? "new"}`}>
          <Input
            id={`g-max-${group?.id ?? "new"}`}
            name="maxSelect"
            type="number"
            min={1}
            max={20}
            required
            defaultValue={group?.maxSelect ?? 1}
          />
        </Field>
      </div>
      <Checkbox
        name="required"
        checked={required}
        onChange={(e) => setRequired(e.target.checked)}
        label="Customers must choose"
        hint="For example a side that comes with the dish."
      />
      <RowsEditor
        prefix="option"
        initial={group?.options ?? []}
        nameLabel="Option"
        priceLabel={`Extra price (${currency})`}
        addLabel="Add option"
      />
    </ActionForm>
  );
}
