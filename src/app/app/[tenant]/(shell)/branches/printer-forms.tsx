"use client";
import { useActionState, useState } from "react";
import type { ActionResult } from "@/server/action";
import { OneTimeSecret } from "@/components/action-form";
import { Button, Field, Input, Notice, Select } from "@/components/ui";

type KeyAction = (p: ActionResult, fd: FormData) => Promise<ActionResult<{ bridgeKey: string | null }>>;

export function PrinterForm({
  action,
  branchId,
  stations,
}: {
  action: KeyAction;
  branchId: string;
  stations: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{
    bridgeKey: string | null;
  }>);
  const [connection, setConnection] = useState("BROWSER");
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="branchId" value={branchId} />
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      {state.ok && state.data?.bridgeKey ? (
        <OneTimeSecret
          label="Print bridge API key"
          value={state.data.bridgeKey}
          note="Paste it into the print bridge on the kitchen computer. It is shown only once."
        />
      ) : state.ok && state.data ? (
        <Notice tone="forest">Printer added.</Notice>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`p-name-${branchId}`}>
          <Input
            id={`p-name-${branchId}`}
            name="name"
            required
            maxLength={40}
            placeholder="e.g. Kitchen thermal printer"
          />
        </Field>
        <Field label="Prints tickets for" htmlFor={`p-station-${branchId}`}>
          <Select id={`p-station-${branchId}`} name="stationId" defaultValue="">
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="How it prints"
          htmlFor={`p-conn-${branchId}`}
          hint={
            connection === "BROWSER"
              ? "Staff print from the print queue with the browser's print dialog (works with any printer)."
              : "Automatic printing via a small helper on the restaurant network (see docs). The helper is not included yet."
          }
        >
          <Select
            id={`p-conn-${branchId}`}
            name="connection"
            value={connection}
            onChange={(e) => setConnection(e.target.value)}
          >
            <option value="BROWSER">Browser print</option>
            <option value="PRINT_BRIDGE">Print bridge (automatic)</option>
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Paper" htmlFor={`p-width-${branchId}`}>
            <Select id={`p-width-${branchId}`} name="paperWidthMm" defaultValue="80">
              <option value="80">80 mm</option>
              <option value="58">58 mm</option>
              <option value="210">A4</option>
            </Select>
          </Field>
          <Field label="Copies" htmlFor={`p-copies-${branchId}`}>
            <Input id={`p-copies-${branchId}`} name="copies" type="number" min={1} max={5} defaultValue={1} />
          </Field>
        </div>
      </div>
      <div>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Adding…" : "Add printer"}
        </Button>
      </div>
    </form>
  );
}

export function RotateKey({ action, printerId }: { action: KeyAction; printerId: string }) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{
    bridgeKey: string | null;
  }>);
  if (state.ok && state.data?.bridgeKey)
    return (
      <OneTimeSecret label="New print bridge key" value={state.data.bridgeKey} note="The old key stopped working." />
    );
  return (
    <form
      action={formAction}
      onSubmit={(e) =>
        !confirm("Replace this printer's API key? The bridge stops printing until you enter the new key.") &&
        e.preventDefault()
      }
    >
      <input type="hidden" name="printerId" value={printerId} />
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        New API key
      </Button>
      {!state.ok ? <span className="text-danger-700 text-xs">{state.error}</span> : null}
    </form>
  );
}
