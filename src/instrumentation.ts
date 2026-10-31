/**
 * Runs once per server process. Starts the mobile money sweeper: re-checks
 * pending payments and cancels unpaid pay-first orders every 20 seconds.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.ZAWLI_DISABLE_SWEEPER === "1") return;
  const { sweepMobileMoney } = await import("./server/services/mobile-money");
  const { logError } = await import("./server/log");
  const timer = setInterval(() => {
    sweepMobileMoney().catch((e) => logError("mobile_money.sweep_failed", e));
  }, 20_000);
  timer.unref?.();
}
