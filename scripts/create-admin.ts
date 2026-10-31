/**
 * Bootstraps the first platform SUPER_ADMIN in any environment WITHOUT a default
 * password: it prints a one-time setup link (72 h) instead.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=you@company.com BOOTSTRAP_ADMIN_NAME="Your Name" npm run admin:create
 */
import "dotenv/config";
import { db } from "../src/server/db";
import { findOrCreateUserForInvite, issueSetupToken, setupUrl } from "../src/server/services/accounts";
import { writeAudit } from "../src/server/audit";

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || "Platform Admin";
  if (!email) throw new Error("Set BOOTSTRAP_ADMIN_EMAIL (and optionally BOOTSTRAP_ADMIN_NAME).");

  const url = await db.$transaction(async (tx) => {
    const invited = await findOrCreateUserForInvite(tx, { email, name, createdById: null });
    await tx.user.update({ where: { id: invited.userId }, data: { platformRole: "SUPER_ADMIN", isActive: true } });
    const token = invited.setupToken ?? (await issueSetupToken(tx, invited.userId, null));
    await writeAudit(tx, {
      action: "platform.admin_bootstrapped",
      entityType: "User",
      entityId: invited.userId,
      metadata: { email },
    });
    return setupUrl(token);
  });
  console.log(`SUPER_ADMIN ready for ${email}.`);
  console.log(`One-time setup link (expires in 72 hours, share privately):\n${url}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
