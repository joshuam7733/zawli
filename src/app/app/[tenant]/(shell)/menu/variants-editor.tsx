"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { ActionResult } from "@/server/action";
import { ActionForm } from "@/components/action-form";
import { Button, Input } from "@/components/ui";

interface Row {
  key: string;
  id?: string;
  name: string;
  price: string;
  isAvailable: boolean;
}

let k = 0;
const nextKey = () => `row-${k++}`;

/** Editable list of rows (sizes or modifier options) posted as parallel arrays. */
export function RowsEditor({
  prefix,
  initial,
  nameLabel,
  priceLabel,
  addLabel,
  allowEmpty,
}: {
  prefix: "variant" | "option";
  initial: Omit<Row, "key">[];
  nameLabel: string;
  priceLabel: string;
  addLabel: string;
  allowEmpty?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    (initial.length ? initial : allowEmpty ? [] : [{ name: "", price: "", isAvailable: true }]).map((r) => ({
      ...r,
      key: nextKey(),
    })),
  );
  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  return (
    <div className="flex flex-col gap-2">
      {rows.length > 0 ? (
        <div className="text-charcoal-500 hidden grid-cols-[minmax(0,1fr)_9rem_6rem_2.5rem] gap-2 text-xs font-medium sm:grid">
          <span>{nameLabel}</span>
          <span>{priceLabel}</span>
          <span>Available</span>
          <span />
        </div>
      ) : null}
      {rows.map((r, i) => (
        <div
          key={r.key}
          className="grid grid-cols-[minmax(0,1fr)_7rem_auto_auto] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_6rem_2.5rem]"
        >
          <input type="hidden" name={`${prefix}Id`} value={r.id ?? ""} />
          <Input
            name={`${prefix}Name`}
            aria-label={`${nameLabel} ${i + 1}`}
            value={r.name}
            onChange={(e) => update(r.key, { name: e.target.value })}
            maxLength={60}
            required
          />
          <Input
            name={`${prefix}Price`}
            aria-label={`${priceLabel} ${i + 1}`}
            inputMode="decimal"
            className="tabular"
            value={r.price}
            onChange={(e) => update(r.key, { price: e.target.value })}
          />
          <label className="flex items-center justify-center gap-2 text-sm">
            <input
              type="checkbox"
              name={`${prefix}Available`}
              value={String(i)}
              checked={r.isAvailable}
              onChange={(e) => update(r.key, { isAvailable: e.target.checked })}
              className="accent-forest-700 size-4"
            />
            <span className="sr-only">Available</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            aria-label={`Remove ${r.name || "row"}`}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      ))}
      <div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setRows((rs) => [...rs, { key: nextKey(), name: "", price: "", isAvailable: true }])}
        >
          <Plus className="size-4" aria-hidden /> {addLabel}
        </Button>
      </div>
    </div>
  );
}

export function VariantsForm({
  action,
  itemId,
  initial,
  currency,
}: {
  action: (p: ActionResult, fd: FormData) => Promise<ActionResult>;
  itemId: string;
  initial: Omit<Row, "key">[];
  currency: string;
}) {
  return (
    <ActionForm action={action} submitLabel="Save sizes">
      <input type="hidden" name="itemId" value={itemId} />
      <RowsEditor
        prefix="variant"
        initial={initial}
        nameLabel="Size / variant"
        priceLabel={`Price (${currency})`}
        addLabel="Add size"
        allowEmpty
      />
      <p className="text-charcoal-500 text-xs">
        Leave empty for a single-price item. Removed sizes are archived; past orders keep them.
      </p>
    </ActionForm>
  );
}
