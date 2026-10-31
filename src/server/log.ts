// Structured server logging. Never pass passwords, tokens, cookies or customer
// personal data in `context`; errors are reduced to name/message/stack.

type Level = "info" | "warn" | "error";

function write(level: Level, event: string, context?: Record<string, unknown>) {
  const line = JSON.stringify({ level, event, at: new Date().toISOString(), ...context });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function logInfo(event: string, context?: Record<string, unknown>) {
  write("info", event, context);
}

export function logWarn(event: string, context?: Record<string, unknown>) {
  write("warn", event, context);
}

export function logError(event: string, err: unknown, context?: Record<string, unknown>) {
  const e =
    err instanceof Error
      ? { name: err.name, message: err.message, stack: err.stack?.split("\n").slice(0, 6).join("\n") }
      : { message: String(err) };
  write("error", event, { ...context, error: e });
}
