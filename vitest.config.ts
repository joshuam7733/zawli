import { config as loadEnv } from "dotenv";
import path from "node:path";
import { defineConfig } from "vitest/config";

loadEnv();
const testDbUrl = process.env.TEST_DATABASE_URL;

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Integration tests share one database: run files one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      // Tests NEVER touch the development database.
      DATABASE_URL: testDbUrl ?? "",
      APP_URL: "http://localhost:3000",
      ZAWLI_DISABLE_RATE_LIMIT: "1",
      NODE_ENV: "test",
    },
  },
});
