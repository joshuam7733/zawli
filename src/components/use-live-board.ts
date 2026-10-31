"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export type Connection = "live" | "polling" | "offline";

/**
 * Keeps a server board fresh:
 *  1. Server-Sent Events say "something changed" → refetch the board.
 *  2. If SSE is unavailable, poll every `pollMs`.
 *  3. On reconnect / tab focus / network back online → refetch, so missed
 *     events are always reconciled from the database (the source of truth).
 */
export function useLiveBoard<T extends { cursor: string }>(
  boardUrl: string,
  eventsUrl: string,
  initial: T,
  pollMs = 15_000,
) {
  const [board, setBoard] = useState<T>(initial);
  const [connection, setConnection] = useState<Connection>("live");
  const [lastUpdated, setLastUpdated] = useState(() => Date.now());
  const router = useRouter();
  const inFlight = useRef(false);
  const again = useRef(false);

  const refetch = useCallback(async () => {
    // Coalesce: while a fetch is running, further requests just mark "again".
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    try {
      do {
        again.current = false;
        const res = await fetch(boardUrl, { cache: "no-store" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (res.ok) {
          setBoard(await res.json());
          setLastUpdated(Date.now());
        }
      } while (again.current);
    } catch {
      setConnection("offline");
    } finally {
      inFlight.current = false;
    }
  }, [boardUrl, router]);

  // Board URL changed (branch/station filter): refetch immediately.
  const firstUrl = useRef(boardUrl);
  useEffect(() => {
    if (firstUrl.current !== boardUrl) void refetch();
  }, [boardUrl, refetch]);

  useEffect(() => {
    let es: EventSource | null = null;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void refetch(), 150);
    };
    // EventSource exists in every supported browser; polling below covers outages.
    es = new EventSource(`${eventsUrl}&cursor=${encodeURIComponent(initial.cursor)}`);
    es.addEventListener("open", () => {
      setConnection("live");
      schedule(); // reconcile anything missed while disconnected
    });
    es.addEventListener("change", schedule);
    es.addEventListener("error", () => setConnection(navigator.onLine ? "polling" : "offline"));
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void refetch();
    }, pollMs);
    const onFocus = () => document.visibilityState === "visible" && void refetch();
    const onOnline = () => {
      setConnection("polling");
      void refetch();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", () => setConnection("offline"));
    return () => {
      es?.close();
      clearInterval(poll);
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsUrl, refetch, pollMs]);

  return { board, setBoard, refetch, connection, lastUpdated };
}

/** Re-renders every `ms` so elapsed timers stay current. */
export function useNow(ms = 15_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** POSTs JSON to a same-origin API and returns the error message, if any. */
export async function postJson(url: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.error?.message ?? "That didn't work. Try again.";
  } catch {
    return "No connection. Your change was not saved — try again when you're back online.";
  }
}
