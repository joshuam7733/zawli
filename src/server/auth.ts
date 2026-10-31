import "server-only";
import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { db } from "./db";

const SESSION_HOURS = 12;

/**
 * Better Auth handles password hashing (scrypt), session cookies (httpOnly,
 * SameSite=Lax, Secure in production), origin checks on its endpoints and
 * sign-in rate limiting. Public self sign-up is disabled: accounts are created by
 * the platform administrator (owners) or by restaurant owners/managers (staff),
 * and activated through one-time setup links (src/server/services/accounts.ts).
 */
export const auth = betterAuth({
  appName: process.env.NEXT_PUBLIC_BRAND_NAME || "Zawli",
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  database: prismaAdapter(db, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
    autoSignIn: false,
  },
  session: {
    expiresIn: SESSION_HOURS * 60 * 60,
    updateAge: 60 * 60,
  },
  rateLimit: {
    enabled: process.env.NODE_ENV !== "test",
    window: 60,
    max: 120,
    customRules: {
      "/sign-in/email": { window: 60, max: 8 },
    },
  },
  user: {
    additionalFields: {
      platformRole: { type: "string", required: false, input: false },
      isActive: { type: "boolean", required: false, input: false, defaultValue: true },
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          const user = await db.user.findUnique({ where: { id: session.userId }, select: { isActive: true } });
          if (!user?.isActive) {
            throw new APIError("FORBIDDEN", { message: "This account has been deactivated." });
          }
        },
        after: async (session) => {
          await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
        },
      },
    },
  },
  advanced: {
    cookiePrefix: "zawli",
    useSecureCookies: process.env.NODE_ENV === "production",
  },
  plugins: [nextCookies()],
});
