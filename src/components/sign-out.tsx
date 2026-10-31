"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/cn";

export function SignOutButton({ className, compact }: { className?: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
      className={cn(
        "text-charcoal-600 hover:bg-ivory-100 hover:text-charcoal-900 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm disabled:opacity-50",
        className,
      )}
    >
      <LogOut className="size-4" aria-hidden />
      {compact ? <span className="sr-only">Sign out</span> : "Sign out"}
    </button>
  );
}
