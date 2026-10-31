"use client";
import { cn } from "@/lib/cn";
import type { Connection } from "./use-live-board";

export function ConnectionPill({ connection, dark }: { connection: Connection; dark?: boolean }) {
  const label =
    connection === "live"
      ? "Live"
      : connection === "polling"
        ? "Reconnecting — refreshing every 15 s"
        : "Offline — showing last known orders";
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-medium",
        dark ? "text-ivory-100 bg-white/10" : "bg-ivory-100 text-charcoal-700",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "size-2 rounded-full",
          connection === "live"
            ? "bg-lime-400"
            : connection === "polling"
              ? "animate-pulse-soft bg-warning-500"
              : "bg-danger-600",
        )}
      />
      {label}
    </span>
  );
}
