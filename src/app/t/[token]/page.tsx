import type { Metadata } from "next";
import { Wordmark } from "@/components/brand";
import { getPublicMenu, resolveQr } from "@/server/services/ordering";
import { CustomerMenu } from "./customer-menu";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Menu", referrer: "no-referrer" };

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="bg-ivory-50 flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <Wordmark className="mb-10 text-xl" />
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-charcoal-600 mt-2 max-w-sm">{body}</p>
    </main>
  );
}

export default async function TableMenuPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const qr = await resolveQr(token);
  if (!qr.ok) {
    return qr.reason === "closed" ? (
      <Message
        title="Not taking orders right now"
        body="This restaurant isn't accepting orders through the QR code at the moment. Please ask a member of staff."
      />
    ) : (
      <Message
        title="This QR code isn't active"
        body="It may have been replaced. Please ask a member of staff for help, or scan the code on your table again."
      />
    );
  }
  const menu = await getPublicMenu(qr.data.tenant.id, qr.data.branch.id);
  return <CustomerMenu token={token} info={qr.data} menu={menu} />;
}
