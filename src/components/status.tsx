import { Badge } from "./ui";
import { ORDER_STATUS_LABEL, ORDER_STATUS_TONE, PAYMENT_STATUS_LABEL } from "@/lib/format";

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={ORDER_STATUS_TONE[status] ?? "neutral"}>{ORDER_STATUS_LABEL[status] ?? status}</Badge>;
}

export function PaymentStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;
  const tone = status === "PAID" ? "forest" : status === "PARTIALLY_PAID" ? "warning" : "neutral";
  return <Badge tone={tone}>{PAYMENT_STATUS_LABEL[status] ?? status}</Badge>;
}

export function TenantStatusBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE" ? "forest" : status === "ONBOARDING" ? "info" : status === "SUSPENDED" ? "warning" : "danger";
  const label =
    { ACTIVE: "Live", ONBOARDING: "Onboarding", SUSPENDED: "Suspended", DEACTIVATED: "Deactivated" }[status] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

export function SubscriptionBadge({ status }: { status: string }) {
  const tone =
    status === "ACTIVE" ? "forest" : status === "TRIAL" ? "info" : status === "PAST_DUE" ? "warning" : "danger";
  const label =
    { ACTIVE: "Active", TRIAL: "Trial", PAST_DUE: "Past due", SUSPENDED: "Suspended", CANCELLED: "Cancelled" }[
      status
    ] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

export function InvoiceBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  if (overdue) return <Badge tone="danger">Overdue</Badge>;
  const tone =
    status === "PAID" ? "forest" : status === "PARTIALLY_PAID" ? "warning" : status === "ISSUED" ? "info" : "neutral";
  const label =
    { DRAFT: "Draft", ISSUED: "Issued", PARTIALLY_PAID: "Part paid", PAID: "Paid", VOID: "Void" }[status] ?? status;
  return <Badge tone={tone}>{label}</Badge>;
}

export function DemoBadge() {
  return (
    <Badge tone="lime" title="Fictional demo data">
      Demo data
    </Badge>
  );
}
