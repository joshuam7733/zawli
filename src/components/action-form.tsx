"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { CheckCircle2 } from "lucide-react";
import type { ActionResult } from "@/server/action";
import { Button, Notice } from "./ui";
import { cn } from "@/lib/cn";

type Action = (prev: ActionResult, fd: FormData) => Promise<ActionResult>;

function SubmitButton({
  label,
  pendingLabel,
  variant,
  size,
  className,
}: {
  label: ReactNode;
  pendingLabel?: ReactNode;
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size={size} disabled={pending} className={className} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Saving…") : label}
    </Button>
  );
}

/**
 * Form bound to a server action returning ActionResult. Shows the error
 * message, an inline success confirmation, and optionally resets on success.
 */
export function ActionForm({
  action,
  children,
  submitLabel = "Save",
  pendingLabel,
  successMessage,
  resetOnSuccess,
  className,
  footer,
  submitVariant = "primary",
  onSuccess,
}: {
  action: Action;
  children: ReactNode;
  submitLabel?: ReactNode;
  pendingLabel?: ReactNode;
  successMessage?: string;
  resetOnSuccess?: boolean;
  className?: string;
  footer?: ReactNode;
  submitVariant?: "primary" | "accent" | "secondary" | "danger";
  onSuccess?: (result: ActionResult) => void;
}) {
  const [initial] = useState<ActionResult>(() => ({ ok: true }));
  const [state, formAction] = useActionState(action, initial);
  const formRef = useRef<HTMLFormElement>(null);
  // The success message belongs to one result; it hides once that result is "dismissed".
  const [dismissed, setDismissed] = useState<ActionResult | null>(null);
  const showSuccess = state !== initial && state.ok && dismissed !== state;

  useEffect(() => {
    if (state === initial || !state.ok) return; // nothing submitted yet, or an error
    if (resetOnSuccess) formRef.current?.reset();
    onSuccess?.(state);
    const t = setTimeout(() => setDismissed(state), 3500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={cn("flex flex-col gap-4", className)}>
      {!state.ok ? <Notice tone="danger">{state.error}</Notice> : null}
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton label={submitLabel} pendingLabel={pendingLabel} variant={submitVariant} />
        {footer}
        <span role="status" aria-live="polite" className="text-forest-700 text-sm">
          {showSuccess && state.ok ? (
            <span className="inline-flex items-center gap-1.5">
              <CheckCircle2 className="size-4" aria-hidden />
              {state.message ?? successMessage ?? "Saved"}
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}

/**
 * One-click action (toggle, archive, regenerate…) rendered as a tiny form.
 * `confirm` asks before submitting destructive or disruptive actions.
 */
export function ActionButton({
  action,
  fields,
  children,
  variant = "secondary",
  size = "sm",
  confirm,
  className,
  title,
}: {
  action: Action;
  fields?: Record<string, string>;
  children: ReactNode;
  variant?: "primary" | "accent" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  confirm?: string;
  className?: string;
  title?: string;
}) {
  const [state, formAction] = useActionState(action, { ok: true } as ActionResult);
  return (
    <form
      action={formAction}
      className="inline-flex flex-col items-start gap-1"
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {Object.entries(fields ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <SubmitButton label={children} pendingLabel={children} variant={variant} size={size} className={className} />
      {!state.ok ? (
        <span role="alert" className="text-danger-700 max-w-xs text-xs">
          {state.error}
        </span>
      ) : null}
      {title ? <span className="sr-only">{title}</span> : null}
    </form>
  );
}

/** Button that runs an action returning a one-time link/secret, then reveals it. */
export function RevealButton({
  action,
  fields,
  label,
  revealLabel,
  note,
  confirm,
}: {
  action: (p: ActionResult, fd: FormData) => Promise<ActionResult<{ setupUrl: string | null }>>;
  fields: Record<string, string>;
  label: string;
  revealLabel: string;
  note?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, { ok: true } as ActionResult<{
    setupUrl: string | null;
  }>);
  if (state.ok && state.data?.setupUrl)
    return <OneTimeSecret label={revealLabel} value={state.data.setupUrl} note={note} />;
  return (
    <form
      action={formAction}
      onSubmit={(e) => confirm && !window.confirm(confirm) && e.preventDefault()}
      className="inline-flex flex-col items-start gap-1"
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Working…" : label}
      </Button>
      {!state.ok ? <span className="text-danger-700 text-xs">{state.error}</span> : null}
    </form>
  );
}

/** Shows a secret/link returned by an action ONCE with a copy button. */
export function OneTimeSecret({ label, value, note }: { label: string; value: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-lime-500/50 bg-lime-300/25 p-3">
      <p className="text-charcoal-900 text-sm font-semibold">{label}</p>
      <div className="mt-2 flex items-center gap-2">
        <input
          readOnly
          value={value}
          aria-label={label}
          className="border-ivory-300 h-9 min-w-0 flex-1 rounded border bg-white px-2 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {note ? <p className="text-charcoal-600 mt-2 text-xs">{note}</p> : null}
    </div>
  );
}
