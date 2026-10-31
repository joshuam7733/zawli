import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPublicOrder } from "@/server/services/ordering";
import { OrderTracker } from "./order-tracker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your order", referrer: "no-referrer" };

export default async function PublicOrderPage({ params }: { params: Promise<{ token: string; publicToken: string }> }) {
  const { token, publicToken } = await params;
  const order = await getPublicOrder(publicToken);
  if (!order) notFound();
  return (
    <OrderTracker initial={JSON.parse(JSON.stringify(order))} publicToken={publicToken} menuHref={`/t/${token}`} />
  );
}
