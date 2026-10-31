// User accounts: creation without self sign-up, one-time setup links, password set.
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { db, type Tx } from "../db";
import { AppError, validation } from "../errors";
import { randomToken, sha256 } from "../tokens";
import { writeAudit } from "../audit";

export const SETUP_TOKEN_TTL_HOURS = 72;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: "Enter a valid email address." }))
  .refine((v) => v.length <= 254, "Email is too long.");

export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number.");

export const personNameSchema = z.string().trim().min(2, "Enter a name.").max(80);

export function setupUrl(token: string): string {
  const base = process.env.APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/setup-account/${token}`;
}

/**
 * Finds or creates a user by email. New users have NO password; they receive a
 * one-time setup token instead (returned in plain text exactly once — only its
 * hash is stored). Existing users with a password get no token.
 */
export async function findOrCreateUserForInvite(
  tx: Tx,
  input: { email: string; name: string; createdById: string | null },
): Promise<{ userId: string; isNew: boolean; setupToken: string | null }> {
  const email = emailSchema.parse(input.email);
  const existing = await tx.user.findUnique({
    where: { email },
    include: { accounts: { where: { providerId: "credential" }, select: { id: true, password: true } } },
  });
  if (existing) {
    if (!existing.isActive) throw validation("This person's account is deactivated. Contact platform support.");
    const hasPassword = existing.accounts.some((a) => !!a.password);
    const setupToken = hasPassword ? null : await issueSetupToken(tx, existing.id, input.createdById);
    return { userId: existing.id, isNew: false, setupToken };
  }
  const user = await tx.user.create({
    data: { id: randomToken(16), email, name: personNameSchema.parse(input.name), emailVerified: false },
  });
  const setupToken = await issueSetupToken(tx, user.id, input.createdById);
  return { userId: user.id, isNew: true, setupToken };
}

export async function issueSetupToken(tx: Tx, userId: string, createdById: string | null): Promise<string> {
  // Invalidate earlier unused links for this user.
  await tx.accountSetupToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken(24);
  await tx.accountSetupToken.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 3600_000),
      createdById,
    },
  });
  return token;
}

export async function getSetupTokenInfo(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const row = await db.accountSetupToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: { select: { email: true, name: true, isActive: true } } },
  });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) return null;
  return { email: row.user.email, name: row.user.name };
}

export const completeSetupSchema = z
  .object({ token: z.string().min(20).max(64), password: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, { message: "Passwords do not match.", path: ["confirmPassword"] });

/** Sets the password for the token's user and consumes the token (single use). */
export async function completeAccountSetup(input: z.infer<typeof completeSetupSchema>): Promise<{ email: string }> {
  const data = completeSetupSchema.parse(input);
  const passwordHash = await hashPassword(data.password);
  return db.$transaction(async (tx) => {
    const row = await tx.accountSetupToken.findUnique({
      where: { tokenHash: sha256(data.token) },
      include: { user: true },
    });
    if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) {
      throw new AppError("NOT_FOUND", "This setup link is invalid or has expired. Ask for a new one.");
    }
    // Consume atomically: a concurrent second use updates 0 rows.
    const consumed = await tx.accountSetupToken.updateMany({
      where: { id: row.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw new AppError("CONFLICT", "This setup link has already been used.");

    const account = await tx.account.findFirst({ where: { userId: row.userId, providerId: "credential" } });
    if (account) {
      await tx.account.update({ where: { id: account.id }, data: { password: passwordHash } });
    } else {
      await tx.account.create({
        data: {
          id: randomToken(16),
          accountId: row.userId,
          providerId: "credential",
          userId: row.userId,
          password: passwordHash,
        },
      });
    }
    await tx.user.update({ where: { id: row.userId }, data: { emailVerified: true } });
    // Sign out other sessions after a password (re)set.
    await tx.session.deleteMany({ where: { userId: row.userId } });
    await writeAudit(tx, {
      actorId: row.userId,
      action: "account.setup_completed",
      entityType: "User",
      entityId: row.userId,
    });
    return { email: row.user.email };
  });
}

/** Directly sets a password (seed scripts and tests only — never exposed over HTTP). */
export async function setPasswordDirect(tx: Tx, userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  const account = await tx.account.findFirst({ where: { userId, providerId: "credential" } });
  if (account) await tx.account.update({ where: { id: account.id }, data: { password: passwordHash } });
  else
    await tx.account.create({
      data: { id: randomToken(16), accountId: userId, providerId: "credential", userId, password: passwordHash },
    });
}
