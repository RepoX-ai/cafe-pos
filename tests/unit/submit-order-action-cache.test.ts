import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PERF-001 follow-up: successful POS checkout must invalidate the cached POS
 * menu so stock badges refresh immediately (same as cancel/refund).
 */

vi.mock("next/server", () => ({
  after: vi.fn((fn: () => void) => fn()),
}));

vi.mock("@/lib/db/client", () => ({ db: {} }));

vi.mock("@/lib/auth/current-user", () => ({
  requireCurrentUser: vi.fn(),
}));

vi.mock("@/server/services/checkout", () => ({
  submitOrderForUser: vi.fn(),
}));

vi.mock("@/server/services/pos-menu-cache", () => ({
  invalidatePosMenuCache: vi.fn(),
}));

vi.mock("@/server/services/rate-limit", () => ({
  claimRateLimitCleanupSlot: vi.fn(() => false),
  consumeRateLimit: vi.fn(),
  deleteExpiredRateLimitBuckets: vi.fn(),
  RATE_LIMITS: { print: () => ({}) },
}));

vi.mock("@/server/services/print-service", () => ({
  createReprintJob: vi.fn(),
  findReprintJob: vi.fn(),
  PrintNotAllowedError: class PrintNotAllowedError extends Error {},
  processPrintJob: vi.fn(),
  recordDevicePrintResult: vi.fn(),
}));

import { requireCurrentUser } from "@/lib/auth/current-user";
import { submitOrderForUser } from "@/server/services/checkout";
import { invalidatePosMenuCache } from "@/server/services/pos-menu-cache";
import { submitOrderAction } from "@/app/pos/actions";

const user = { id: "user-1", businessId: "biz-1", roles: ["cashier"] as never[] };

describe("submitOrderAction POS menu cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCurrentUser).mockResolvedValue(user as never);
  });

  it("invalidates the POS menu cache after a successful submit", async () => {
    vi.mocked(submitOrderForUser).mockResolvedValue({
      ok: true,
      orderId: "ord-1",
      orderNumber: "0001",
      total: 10000,
      cashReceived: null,
      changeDue: null,
      idempotent: false,
      printStatus: "QUEUED",
    });

    const result = await submitOrderAction({ anything: true });
    expect(result).toMatchObject({ ok: true, orderId: "ord-1" });
    expect(invalidatePosMenuCache).toHaveBeenCalledOnce();
    expect(invalidatePosMenuCache).toHaveBeenCalledWith("biz-1");
  });

  it("does not invalidate the cache when submit fails", async () => {
    vi.mocked(submitOrderForUser).mockResolvedValue({ ok: false, error: "Insufficient stock." });

    const result = await submitOrderAction({ anything: true });
    expect(result).toEqual({ ok: false, error: "Insufficient stock." });
    expect(invalidatePosMenuCache).not.toHaveBeenCalled();
  });
});
