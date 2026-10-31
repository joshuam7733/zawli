import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { getSessionUser } from "@/server/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only allow same-site relative redirects after sign-in.
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/app";
  if (await getSessionUser()) redirect(safeNext);
  return (
    <AuthShell title="Sign in" subtitle="Restaurant staff and platform administrators.">
      <LoginForm next={safeNext} />
      {process.env.NODE_ENV !== "production" ? (
        <p className="bg-ivory-100 text-charcoal-600 mt-8 rounded-md px-3 py-2 text-xs">
          Development: demo accounts are listed in <code className="font-mono">docs/LOCAL_SETUP.md</code>.
        </p>
      ) : null}
    </AuthShell>
  );
}
