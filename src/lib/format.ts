// Locale/timezone-aware display helpers (client and server safe).
export { formatMoney, formatAmount } from "@/domain/money";

export function formatDateTime(d: Date | string, timeZone: string, locale = "en-UG"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(d));
}

export function formatDate(d: Date | string, timeZone: string, locale = "en-UG"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium" }).format(new Date(d));
}

export function formatTime(d: Date | string, timeZone: string, locale = "en-UG"): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(d));
}

/** "4 min", "1 h 12 min" — elapsed since `from`. */
export function elapsed(from: Date | string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return `${h} h ${mins % 60} min`;
}

export function elapsedMinutes(from: Date | string, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(from).getTime()) / 60_000));
}

/** "menu.price_changed" → "Menu price changed" */
export function describeAction(action: string): string {
  return action.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment",
  PLACED: "New",
  ACKNOWLEDGED: "Acknowledged",
  PREPARING: "Preparing",
  READY: "Ready",
  OUT_FOR_DELIVERY: "On the way",
  SERVED: "Served",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

export const ORDER_STATUS_TONE: Record<string, "neutral" | "forest" | "lime" | "warning" | "danger" | "info"> = {
  PENDING_PAYMENT: "neutral",
  PLACED: "warning",
  ACKNOWLEDGED: "info",
  PREPARING: "info",
  READY: "lime",
  OUT_FOR_DELIVERY: "lime",
  SERVED: "forest",
  COMPLETED: "neutral",
  CANCELLED: "danger",
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  UNPAID: "Unpaid",
  PARTIALLY_PAID: "Part paid",
  PAID: "Paid",
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  MOBILE_MONEY: "Mobile money",
  CARD: "Card / POS",
  OTHER: "Other",
};

export const FULFILLMENT_LABEL: Record<string, string> = {
  DIGITAL_DISPLAY: "Kitchen display",
  PRINTER: "Printed tickets",
  MANUAL: "Manual queue",
  DIGITAL_AND_PRINTER: "Display + printer",
};

export const FULFILLMENT_HINT: Record<string, string> = {
  DIGITAL_DISPLAY: "Orders appear on a kitchen screen (tablet, TV or laptop).",
  PRINTER: "Kitchen tickets are printed. Floor staff move orders along from the order queue.",
  MANUAL: "Orders appear in a simple staff queue that you print or pass on by hand.",
  DIGITAL_AND_PRINTER: "Orders appear on the kitchen screen and are also queued for printing.",
};
