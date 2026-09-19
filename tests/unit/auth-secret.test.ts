import { createHmac, createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthSecretError,
  assertAuthSecretConfigured,
  getAuthSecret,
} from "@/lib/auth/secret";

describe("assertAuthSecretConfigured", () => {
  it("requires AUTH_SECRET in every environment", () => {
    expect(() =>
      assertAuthSecretConfigured({ NODE_ENV: "development" }),
    ).toThrow(AuthSecretError);
  });

  it("allows a local placeholder outside production", () => {
    expect(
      assertAuthSecretConfigured({
        NODE_ENV: "development",
        AUTH_SECRET: "change-me-to-a-random-32-byte-secret",
      }),
    ).toBe("change-me-to-a-random-32-byte-secret");
  });

  it("rejects known weak placeholders in production", () => {
    expect(() =>
      assertAuthSecretConfigured({
        NODE_ENV: "production",
        AUTH_SECRET: "dev-only-not-for-production",
      }),
    ).toThrow(/insecure placeholder/i);
  });

  it("rejects short secrets in production", () => {
    expect(() =>
      assertAuthSecretConfigured({
        NODE_ENV: "production",
        AUTH_SECRET: "too-short-to-be-safe",
      }),
    ).toThrow(/at least 32/i);
  });

  it("accepts a long unique secret in production", () => {
    const secret = "a".repeat(32) + "-production-ok";
    expect(
      getAuthSecret({
        NODE_ENV: "production",
        AUTH_SECRET: secret,
      }),
    ).toBe(secret);
  });
});

describe("session token hashing contract", () => {
  it("uses HMAC-SHA256 peppered with AUTH_SECRET (not plain SHA-256)", () => {
    const secret = "unit-test-auth-secret-min-32-chars!!";
    const token = "example-session-token";
    const hmac = createHmac("sha256", secret).update(token).digest("hex");
    const plain = createHash("sha256").update(token).digest("hex");
    expect(hmac).not.toBe(plain);
    expect(hmac).toMatch(/^[0-9a-f]{64}$/);
  });
});
