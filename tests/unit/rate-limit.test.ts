import { beforeEach, describe, expect, it } from "vitest";
import { clearAttempts, isRateLimited, recordAttempt } from "@/lib/auth/rate-limit";

describe("rate limiter", () => {
  const key = "1.2.3.4:test@example.com";

  beforeEach(() => {
    clearAttempts(key);
  });

  it("allows attempts under the threshold", () => {
    for (let i = 0; i < 9; i++) recordAttempt(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("blocks once the threshold is reached", () => {
    for (let i = 0; i < 10; i++) recordAttempt(key);
    expect(isRateLimited(key)).toBe(true);
  });

  it("clearing attempts (successful login) resets the limiter", () => {
    for (let i = 0; i < 10; i++) recordAttempt(key);
    expect(isRateLimited(key)).toBe(true);
    clearAttempts(key);
    expect(isRateLimited(key)).toBe(false);
  });

  it("tracks distinct keys independently", () => {
    for (let i = 0; i < 10; i++) recordAttempt(key);
    expect(isRateLimited("5.6.7.8:other@example.com")).toBe(false);
  });
});
