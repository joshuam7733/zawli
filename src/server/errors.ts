// Typed application errors. Messages are safe to show to the user; never put
// secrets or internal identifiers from another tenant into them.

export type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "TENANT_SUSPENDED"
  | "UNAVAILABLE";

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  TENANT_SUSPENDED: 423,
  UNAVAILABLE: 503,
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;
  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.details = details;
  }
  get status() {
    return HTTP_STATUS[this.code];
  }
}

export const unauthenticated = (msg = "Please sign in to continue.") => new AppError("UNAUTHENTICATED", msg);
export const forbidden = (msg = "You do not have permission to do that.") => new AppError("FORBIDDEN", msg);
/** Used for missing records AND for records owned by another tenant (no existence leak). */
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found.`);
export const validation = (msg: string, details?: unknown) => new AppError("VALIDATION", msg, details);
export const conflict = (msg: string) => new AppError("CONFLICT", msg);

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Prisma unique-constraint violation. */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
