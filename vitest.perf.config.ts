import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Performance checks against a disposable, seeded database (see
 * scripts/perf/seed.ts). Not part of `npm test` or the integration suite:
 *
 *   createdb cafe_pos_perf && DATABASE_URL=.../cafe_pos_perf npm run db:migrate
 *   DATABASE_URL=.../cafe_pos_perf npm run perf:seed
 *   PERF_DATABASE_URL=.../cafe_pos_perf npm run test:perf
 *
 * Results are printed as JSON lines and written to perf-results/ (gitignored).
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/perf/**/*.perf.ts"],
    testTimeout: 15 * 60_000,
    hookTimeout: 5 * 60_000,
    fileParallelism: false,
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
