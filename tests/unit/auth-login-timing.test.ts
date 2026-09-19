import { describe, expect, it, vi } from "vitest";

/**
 * SEC-004: missing-user logins must still pay for one bcrypt.compare.
 * We assert the service always calls verifyPassword — including when the
 * lookup returns no row — by stubbing the DB and the password helper.
 */
vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => false),
}));

vi.mock("@/lib/auth/session", () => ({
  createSession: vi.fn(),
  invalidateSessionToken: vi.fn(),
  resolveDefaultMembership: vi.fn(),
}));

vi.mock("@/server/services/audit", () => ({
  recordAuditLog: vi.fn(),
}));

import { verifyPassword } from "@/lib/auth/password";
import { login } from "@/server/services/auth-service";

describe("login timing oracle (SEC-004)", () => {
  it("still runs verifyPassword when no user matches the email", async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [],
          }),
        }),
      }),
    };

    const result = await login(db as never, "nobody@example.com", "any-password");
    expect(result).toEqual({ ok: false, error: "invalid_credentials" });
    expect(verifyPassword).toHaveBeenCalledOnce();
    expect(verifyPassword).toHaveBeenCalledWith(
      "any-password",
      expect.stringMatching(/^\$2[aby]\$\d{2}\$/),
    );
  });
});
