import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { buttonClass, Notice } from "@/components/ui";
import { getSetupTokenInfo } from "@/server/services/accounts";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Set up your account", referrer: "no-referrer" };

export default async function SetupAccountPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await getSetupTokenInfo(token);
  if (!info) {
    return (
      <AuthShell title="This link has expired">
        <Notice tone="warning">
          Setup links work once and expire after 72 hours. Ask your restaurant owner, manager or the platform
          administrator for a new one.
        </Notice>
        <Link href="/login" className={buttonClass("secondary", "md", "mt-6")}>
          Go to sign in
        </Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell
      title={`Welcome, ${info.name.split(" ")[0]}`}
      subtitle={
        <>
          Choose a password for <strong>{info.email}</strong>.
        </>
      }
    >
      <SetupForm token={token} email={info.email} />
    </AuthShell>
  );
}
