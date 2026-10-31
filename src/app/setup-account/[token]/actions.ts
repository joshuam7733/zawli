"use server";
import { runAction, type ActionResult } from "@/server/action";
import { completeAccountSetup } from "@/server/services/accounts";

export async function completeSetupAction(_prev: ActionResult, fd: FormData): Promise<ActionResult<{ email: string }>> {
  return runAction(() =>
    completeAccountSetup({
      token: String(fd.get("token") ?? ""),
      password: String(fd.get("password") ?? ""),
      confirmPassword: String(fd.get("confirmPassword") ?? ""),
    }),
  );
}
