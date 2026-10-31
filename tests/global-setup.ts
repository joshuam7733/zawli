// Prepares the dedicated TEST database once per run: applies migrations, then
// empties every table. Refuses to run against anything that is not clearly a
// test database.
import { execSync } from "node:child_process";
import { config as loadEnv } from "dotenv";
import pg from "pg";

export default async function setup() {
  loadEnv();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example).");
  const dbName = new URL(url).pathname.slice(1);
  if (!/test/i.test(dbName)) throw new Error(`Refusing to use "${dbName}" for tests: the name must contain "test".`);

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (rows.length) {
    await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  }
  await client.end();
}
