"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import type { ActionResult } from "@/server/action";
import { Button, Field, Input, Notice } from "@/components/ui";
import { completeSetupAction } from "./actions";

export function SetupForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult>({ ok: true });
  const [signingIn, setSigningIn] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    startTransition(async () => {
      const res = await completeSetupAction({ ok: true }, fd);
      setResult(res);
      if (!res.ok) return;
      // Password saved: sign straight in with it.
      setSigningIn(true);
      const { error } = await authClient.signIn.email({ email, password: String(fd.get("password") ?? "") });
      router.replace(error ? "/login" : "/app");
      router.refresh();
    });
  }

  const fieldErrors = !result.ok ? result.fieldErrors : undefined;
  return (
    <form action={submit} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="email" value={email} autoComplete="username" />
      {!result.ok && !fieldErrors?.password && !fieldErrors?.confirmPassword ? (
        <Notice tone="danger">{result.error}</Notice>
      ) : null}
      <Field
        label="New password"
        htmlFor="password"
        hint="At least 10 characters, with letters and a number."
        error={fieldErrors?.password}
      >
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          aria-invalid={!!fieldErrors?.password}
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" error={fieldErrors?.confirmPassword}>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          aria-invalid={!!fieldErrors?.confirmPassword}
        />
      </Field>
      <Button type="submit" size="lg" disabled={pending || signingIn} className="mt-2">
        {signingIn ? "Signing you in…" : pending ? "Saving…" : "Save password and continue"}
      </Button>
    </form>
  );
}
