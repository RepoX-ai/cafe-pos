import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Integration tests hit a real Postgres database (via TEST_DATABASE_URL)
 * and are not run by `npm test`. Run them explicitly:
 *
 *   docker compose up -d db
 *   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/cafe_pos_test npm run test:integration
 *
 * (create the test database once, then `npm run db:migrate` against it —
 * or point TEST_DATABASE_URL at any disposable Postgres you're fine with
 * these tests writing rows into).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
