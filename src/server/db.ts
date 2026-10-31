// Server-side only (it needs `pg`); also imported by the seed script and tests.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set. See docs/LOCAL_SETUP.md.");
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: process.env.PRISMA_LOG === "1" ? ["query", "warn", "error"] : ["error"] });
}

const globalForPrisma = globalThis as unknown as { __zawliPrisma?: ReturnType<typeof createClient> };

/** Shared Prisma client (one per server process; reused across hot reloads in dev). */
export const db = globalForPrisma.__zawliPrisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__zawliPrisma = db;

export type Db = typeof db;
/** Interactive-transaction client type. */
export type Tx = Parameters<Parameters<Db["$transaction"]>[0]>[0];
