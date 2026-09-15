import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests run against a real dev server backed by the Docker
 * Compose Postgres + a seeded database:
 *   docker compose up -d db
 *   npm run db:migrate && npm run db:seed
 *   npm run test:e2e
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: process.env.APP_URL || "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "ipad-landscape",
      use: { ...devices["iPad (gen 7) landscape"] },
    },
  ],
  // APP_URL points the tests at a server you started yourself (handy when a
  // dev server is already running, since Next refuses a second one).
  webServer: process.env.APP_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
