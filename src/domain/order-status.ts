// Controlled order & kitchen-ticket state machines. Pure functions — no I/O.
import type { OrderStatus, TicketStatus } from "@/generated/prisma/enums";

export const ORDER_FLOW: readonly OrderStatus[] = [
  "PLACED",
  "ACKNOWLEDGED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "SERVED",
  "COMPLETED",
] as const;

/**
 * Allowed order transitions. Kitchen states (ACKNOWLEDGED → READY) are normally
 * derived from kitchen tickets (see deriveOrderStatusFromTickets). OUT_FOR_DELIVERY
 * is optional: READY may go straight to SERVED.
 */
const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  // Pay-first: reaches the kitchen (PLACED) only once paid; unpaid orders are cancelled.
  PENDING_PAYMENT: ["PLACED", "CANCELLED"],
  PLACED: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["OUT_FOR_DELIVERY", "SERVED", "CANCELLED"],
  OUT_FOR_DELIVERY: ["SERVED"],
  SERVED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function nextOrderStatuses(from: OrderStatus): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[from];
}

export function isTerminalOrderStatus(s: OrderStatus): boolean {
  return s === "COMPLETED" || s === "CANCELLED";
}

/** Orders the kitchen still has to work on. */
export const ACTIVE_KITCHEN_ORDER_STATUSES: readonly OrderStatus[] = ["PLACED", "ACKNOWLEDGED", "PREPARING"];
/** Orders still open from the floor's point of view. */
export const OPEN_ORDER_STATUSES: readonly OrderStatus[] = [
  "PLACED",
  "ACKNOWLEDGED",
  "PREPARING",
  "READY",
  "OUT_FOR_DELIVERY",
  "SERVED",
];

const TICKET_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  PLACED: ["ACKNOWLEDGED", "CANCELLED"],
  ACKNOWLEDGED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: [],
  CANCELLED: [],
};

export function canTransitionTicket(from: TicketStatus, to: TicketStatus): boolean {
  return TICKET_TRANSITIONS[from].includes(to);
}

export function nextTicketStatus(from: TicketStatus): TicketStatus | null {
  return TICKET_TRANSITIONS[from].find((s) => s !== "CANCELLED") ?? null;
}

const ORDER_RANK: Record<OrderStatus, number> = {
  PENDING_PAYMENT: -1,
  PLACED: 0,
  ACKNOWLEDGED: 1,
  PREPARING: 2,
  READY: 3,
  OUT_FOR_DELIVERY: 4,
  SERVED: 5,
  COMPLETED: 6,
  CANCELLED: 99,
};

/**
 * The kitchen-side order status implied by its tickets (ignoring cancelled tickets):
 * every ticket READY → READY; any ticket PREPARING/READY → PREPARING;
 * any ticket ACKNOWLEDGED → ACKNOWLEDGED; otherwise PLACED.
 * The result never moves an order backwards — callers compare with the current status.
 */
export function deriveOrderStatusFromTickets(tickets: readonly TicketStatus[]): OrderStatus {
  const live = tickets.filter((t) => t !== "CANCELLED");
  if (live.length === 0) return "PLACED";
  if (live.every((t) => t === "READY")) return "READY";
  if (live.some((t) => t === "PREPARING" || t === "READY")) return "PREPARING";
  if (live.some((t) => t === "ACKNOWLEDGED")) return "ACKNOWLEDGED";
  return "PLACED";
}

/**
 * Sequence of transitions needed to move an order forward from `current` to
 * `target` along the kitchen flow, e.g. PLACED → READY = [ACKNOWLEDGED, PREPARING, READY].
 * Returns [] when target is not ahead of current.
 */
export function forwardPath(current: OrderStatus, target: OrderStatus): OrderStatus[] {
  if (current === "CANCELLED" || target === "CANCELLED") return [];
  // Only a confirmed payment may move an order out of PENDING_PAYMENT.
  if (current === "PENDING_PAYMENT" || target === "PENDING_PAYMENT") return [];
  if (ORDER_RANK[target] <= ORDER_RANK[current]) return [];
  const path: OrderStatus[] = [];
  let s: OrderStatus = current;
  while (s !== target) {
    const next: OrderStatus | undefined = ORDER_FLOW[ORDER_RANK[s] + 1];
    if (!next || !canTransitionOrder(s, next)) return [];
    path.push(next);
    s = next;
  }
  return path;
}
