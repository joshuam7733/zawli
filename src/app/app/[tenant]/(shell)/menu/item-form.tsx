"use client";
import type { ActionResult } from "@/server/action";
import { ActionForm } from "@/components/action-form";
import { ImageUpload } from "@/components/image-upload";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export interface ItemFormValues {
  itemId?: string;
  categoryId?: string;
  name?: string;
  description?: string | null;
  price?: string;
  allergens?: string | null;
  prepNotes?: string | null;
  imageUrl?: string | null;
  isAvailable?: boolean;
}

export function ItemForm({
  action,
  tenantSlug,
  categories,
  currency,
  values = {},
  hasVariants,
  submitLabel,
}: {
  action: (prev: ActionResult, fd: FormData) => Promise<ActionResult>;
  tenantSlug: string;
  categories: { id: string; name: string }[];
  currency: string;
  values?: ItemFormValues;
  hasVariants?: boolean;
  submitLabel: string;
}) {
  return (
    <ActionForm action={action} submitLabel={submitLabel}>
      {values.itemId ? <input type="hidden" name="itemId" value={values.itemId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="name">
          <Input
            id="name"
            name="name"
            required
            maxLength={80}
            defaultValue={values.name}
            placeholder="e.g. Chicken luwombo"
          />
        </Field>
        <Field label="Category" htmlFor="categoryId">
          <Select id="categoryId" name="categoryId" required defaultValue={values.categoryId}>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label={`Price (${currency})`}
          htmlFor="price"
          hint={hasVariants ? "This item has sizes — customers pay the size price below." : "Numbers only, e.g. 25000."}
        >
          <Input
            id="price"
            name="price"
            inputMode="decimal"
            required
            defaultValue={values.price ?? ""}
            className="tabular"
          />
        </Field>
        <Field
          label="Allergens"
          htmlFor="allergens"
          hint="Shown to customers and on kitchen tickets, e.g. “Peanuts, gluten”."
        >
          <Input id="allergens" name="allergens" maxLength={200} defaultValue={values.allergens ?? ""} />
        </Field>
      </div>
      <Field label="Description" htmlFor="description" hint="Optional. Shown on the customer menu.">
        <Textarea
          id="description"
          name="description"
          maxLength={400}
          rows={2}
          defaultValue={values.description ?? ""}
        />
      </Field>
      <Field
        label="Kitchen preparation notes"
        htmlFor="prepNotes"
        hint="Internal only — shown to kitchen staff, never to customers."
      >
        <Input id="prepNotes" name="prepNotes" maxLength={300} defaultValue={values.prepNotes ?? ""} />
      </Field>
      <ImageUpload tenantSlug={tenantSlug} name="imageUrl" defaultValue={values.imageUrl} />
      <Checkbox
        name="isAvailable"
        defaultChecked={values.isAvailable ?? true}
        label="Available to order"
        hint="Untick to mark as sold out at every branch."
      />
    </ActionForm>
  );
}
