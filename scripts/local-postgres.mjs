// Starts a real PostgreSQL server for local development WITHOUT Docker or a system
// install. Binaries come from the `embedded-postgres` npm package; data lives in
// ./.pg-data (git-ignored). Development use only.
//
//   npm run db:local          # keep this terminal open
//
// If you have Docker, `docker compose up db` is an equivalent alternative.
import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const user = process.env.LOCAL_PG_USER ?? "zawli";
const password = process.env.LOCAL_PG_PASSWORD ?? "zawli_dev_password";
const databaseDir = path.resolve(".pg-data");

const pg = new EmbeddedPostgres({
  databaseDir,
  user,
  password,
  port,
  persistent: true,
  // UTF-8 regardless of the OS locale (Windows defaults to WIN1252); UTC server clock.
  initdbFlags: ["--encoding=UTF8", "--locale=C", "--auth=scram-sha-256"],
  postgresFlags: ["-c", "timezone=UTC"],
  onLog: () => {},
});

async function main() {
  if (!existsSync(path.join(databaseDir, "PG_VERSION"))) {
    console.log(`[db:local] Initialising new cluster in ${databaseDir}`);
    await pg.initialise();
  }
  await pg.start();
  for (const name of ["zawli", "zawli_test"]) {
    try {
      await pg.createDatabase(name);
      console.log(`[db:local] Created database ${name}`);
    } catch {
      // already exists
    }
  }
  console.log(`[db:local] PostgreSQL ready on localhost:${port} (user "${user}"). Ctrl+C to stop.`);
}

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log("\n[db:local] Stopping PostgreSQL…");
  await pg.stop().catch(() => {});
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

main().catch(async (err) => {
  console.error("[db:local] Failed to start PostgreSQL:", err);
  await pg.stop().catch(() => {});
  process.exit(1);
});

// Keep the process alive while the server runs.
setInterval(() => {}, 1 << 30);
