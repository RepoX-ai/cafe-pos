import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration tests hit a real Postgres database (via TEST_DATABASE_URL)
 * and are not run by `npm test`. Run them explicitly:
 *
 *   docker compose up -d db
 *   AUTH_SECRET=test-only-auth-secret-min-32-characters! \
 *     TEST_DATABASE_URL=postgres://postgres:local-dev-only-postgres-not-for-prod@localhost:5432/cafe_pos_test \
 *     npm run test:integration
 *
 * (create the test database once, then `npm run db:migrate` against it —
 * or point TEST_DATABASE_URL at any disposable Postgres you're fine with
 * these tests writing rows into). AUTH_SECRET is also injected via `test.env`
 * below so createSession HMAC hashing works without extra exports.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
    env: {
      AUTH_SECRET: "test-only-auth-secret-min-32-characters!",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
