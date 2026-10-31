// Small, accessible UI kit shared by every surface. Server-component safe.
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

// ───────────── Buttons ─────────────

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest-600";
const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-forest-800 text-ivory-50 hover:bg-forest-700 active:bg-forest-900",
  accent: "bg-lime-400 text-charcoal-950 hover:bg-lime-300 active:bg-lime-500",
  secondary: "border border-ivory-300 bg-white text-charcoal-900 hover:bg-ivory-100",
  ghost: "text-charcoal-700 hover:bg-ivory-100",
  danger: "bg-danger-600 text-white hover:bg-danger-700",
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-base",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string) {
  return cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

// ───────────── Form controls ─────────────

const CONTROL =
  "w-full rounded-md border border-ivory-300 bg-white px-3 text-sm text-charcoal-900 placeholder:text-charcoal-400 transition-colors hover:border-charcoal-300 focus:border-forest-600 focus:ring-2 focus:ring-forest-600/20 focus:outline-none disabled:bg-ivory-100 disabled:text-charcoal-500 aria-[invalid=true]:border-danger-600";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(CONTROL, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(CONTROL, "min-h-20 py-2", className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        CONTROL,
        "h-10 appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9",
        className,
      )}
      style={{ backgroundImage: SELECT_CHEVRON }}
      {...props}
    >
      {children}
    </select>
  );
}
const SELECT_CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='%236e6e66' stroke-width='1.5'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E")`;

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-charcoal-800 text-sm font-medium", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-danger-700 text-sm">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-charcoal-500 text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  className,
  ...props
}: ComponentProps<"input"> & { label: ReactNode; hint?: ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-3", className)}>
      <input
        type="checkbox"
        className="border-ivory-300 accent-forest-700 mt-0.5 size-4 shrink-0 cursor-pointer rounded"
        {...props}
      />
      <span className="flex flex-col">
        <span className="text-charcoal-900 text-sm font-medium">{label}</span>
        {hint ? <span className="text-charcoal-500 text-xs">{hint}</span> : null}
      </span>
    </label>
  );
}

// ───────────── Surfaces ─────────────

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("border-ivory-200 shadow-card rounded-lg border bg-white", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("border-ivory-200 flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4", className)}
    >
      <div className="min-w-0">
        <h2 className="text-charcoal-900 text-base font-semibold">{title}</h2>
        {description ? <p className="text-charcoal-500 mt-0.5 text-sm">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-forest-600 mb-1 text-xs font-semibold tracking-wider uppercase">{eyebrow}</p>
        ) : null}
        <h1 className="font-display text-charcoal-950 text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        {description ? <p className="text-charcoal-600 mt-1 max-w-2xl text-sm">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon ? <div className="text-charcoal-400 mb-3">{icon}</div> : null}
      <p className="text-charcoal-900 text-base font-semibold">{title}</p>
      {description ? <p className="text-charcoal-500 mt-1 max-w-md text-sm">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

type Tone = "neutral" | "forest" | "lime" | "warning" | "danger" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-ivory-100 text-charcoal-700 ring-ivory-300",
  forest: "bg-forest-50 text-forest-700 ring-forest-100",
  lime: "bg-lime-300/50 text-charcoal-900 ring-lime-500/40",
  warning: "bg-warning-50 text-warning-700 ring-warning-500/30",
  danger: "bg-danger-50 text-danger-700 ring-danger-600/20",
  info: "bg-info-50 text-info-700 ring-info-700/15",
};

export function Badge({ tone = "neutral", className, ...props }: ComponentProps<"span"> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded-md px-4 py-3 text-sm ring-1 ring-inset", TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "alert";
}) {
  return (
    <div
      className={cn(
        "shadow-card rounded-lg border bg-white px-4 py-3.5",
        tone === "alert" ? "border-warning-500/40" : "border-ivory-200",
      )}
    >
      <p className="text-charcoal-500 text-xs font-medium tracking-wide uppercase">{label}</p>
      <p className="tabular font-display text-charcoal-950 mt-1 text-2xl font-semibold">{value}</p>
      {hint ? <p className="text-charcoal-500 mt-0.5 text-xs">{hint}</p> : null}
    </div>
  );
}

// ───────────── Tables ─────────────

export function Table({ className, ...props }: ComponentProps<"table">) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: ComponentProps<"th">) {
  return (
    <th
      scope="col"
      className={cn(
        "border-ivory-200 bg-ivory-50 text-charcoal-500 border-b px-4 py-2.5 text-xs font-semibold tracking-wide uppercase",
        className,
      )}
      {...props}
    />
  );
}
export function Td({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("border-ivory-200/70 border-b px-4 py-3 align-middle", className)} {...props} />;
}
