import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    env: {
      // Pepper for HMAC session hashing in unit tests that touch auth helpers.
      AUTH_SECRET: "test-only-auth-secret-min-32-characters!",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
