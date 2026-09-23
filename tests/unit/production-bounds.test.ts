import { describe, expect, it } from "vitest";
import { createWorkLimiter, WorkLimitExceededError } from "@/lib/work-limiter";
import { PoolConfigError, resolvePoolSettings, toPgPoolConfig } from "@/lib/db/pool-config";
import {
  assertBusinessTimezoneConfig,
  bucketStarts,
  BusinessTimezoneConfigError,
  calendarDaysInclusive,
  chartGranularity,
  isCalendarDate,
  MAX_REPORT_RANGE_DAYS,
  resolveReportDateRange,
} from "@/lib/dates/dates";
import { MAX_BROWSABLE_ROWS, pageWindow, totalPageCount } from "@/lib/pagination";
import { purchaseInputSchema } from "@/lib/validation/purchase";
import { stockCountInputSchema } from "@/lib/validation/stock-count";
import { itemModifierGroupsSchema, modifierGroupInputSchema, menuItemInputSchema } from "@/lib/validation/menu";
import { expenseInputSchema } from "@/lib/validation/expense";
import { recipeInputSchema } from "@/lib/validation/recipe";
import { payloadHash } from "@/server/services/request-idempotency";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("work limiter", () => {
  it("runs at most `max` at once, queues up to `maxQueue`, and refuses the rest", async () => {
    const limiter = createWorkLimiter("test", 2, 1);
    const gates: Array<() => void> = [];
    const task = () => new Promise<void>((resolve) => gates.push(resolve));
    const running = [limiter.run(task), limiter.run(task), limiter.run(task)];
    await Promise.resolve();
    expect(limiter.active).toBe(2);
    expect(limiter.queued).toBe(1);
    await expect(limiter.run(task)).rejects.toBeInstanceOf(WorkLimitExceededError);

    gates.shift()!();
    await running[0];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(limiter.active).toBe(2); // the queued task took the freed slot
    expect(limiter.queued).toBe(0);
    gates.splice(0).forEach((open) => open());
    await new Promise((resolve) => setTimeout(resolve, 0));
    gates.splice(0).forEach((open) => open());
    await Promise.all(running);
    expect(limiter.active).toBe(0);
  });

  it("frees its slot when a task throws", async () => {
    const limiter = createWorkLimiter("test", 1, 0);
    await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(limiter.run(async () => 42)).resolves.toBe(42);
  });
});

describe("pool configuration", () => {
  it("uses safe defaults with session timeouts on", () => {
    const app = resolvePoolSettings("app", {});
    expect(app).toMatchObject({ max: 5, sessionTimeouts: { statement: 15_000, lock: 5_000, idleInTransaction: 30_000 } });
    expect(resolvePoolSettings("reports", {}).max).toBe(2);
    expect(toPgPoolConfig("postgres://x", app)).toMatchObject({ statement_timeout: 15_000, lock_timeout: 5_000, application_name: "cafe-pos" });
  });

  it("refuses malformed or out-of-range values instead of falling back", () => {
    for (const bad of ["abc", "0", "-1", "5.5", "1000"]) {
      expect(() => resolvePoolSettings("app", { DATABASE_POOL_MAX: bad })).toThrow(PoolConfigError);
    }
    expect(() => resolvePoolSettings("reports", { DATABASE_REPORT_STATEMENT_TIMEOUT_MS: "fast" })).toThrow(PoolConfigError);
    expect(() => resolvePoolSettings("app", { DATABASE_SESSION_TIMEOUTS: "maybe" })).toThrow(PoolConfigError);
  });

  it("can drop startup-parameter timeouts for a pooler that rejects them", () => {
    const settings = resolvePoolSettings("app", { DATABASE_SESSION_TIMEOUTS: "off" });
    expect(settings.sessionTimeouts).toBeNull();
    expect(toPgPoolConfig("postgres://x", settings)).not.toHaveProperty("statement_timeout");
  });
});

describe("report date bounds", () => {
  it("rejects dates outside the supported years, including ones that break day arithmetic", () => {
    for (const bad of ["0001-01-01", "1999-12-31", "2100-01-01", "9999-12-31", "2026-02-30", "+02026-01-01"]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
    expect(isCalendarDate("2000-01-01")).toBe(true);
    expect(isCalendarDate("2099-12-31")).toBe(true);
  });

  it("caps an interactive range at MAX_REPORT_RANGE_DAYS, keeping the most recent part", () => {
    const today = "2026-09-23";
    const { range, clamped } = resolveReportDateRange("2000-01-01", "2099-12-31", { from: today, to: today });
    expect(clamped).toBe(true);
    expect(range.to).toBe("2099-12-31");
    expect(calendarDaysInclusive(range)).toBe(MAX_REPORT_RANGE_DAYS);
    // Extreme strings are not dates at all: they fall back to the defaults.
    expect(resolveReportDateRange("0001-01-01", "9999-12-31", { from: today, to: today })).toEqual({ range: { from: today, to: today }, clamped: false });
    expect(resolveReportDateRange("2026-09-01", "2026-09-23", { from: today, to: today }).clamped).toBe(false);
  });

  it("never produces more than ~62 chart points for the largest allowed range", () => {
    for (const days of [1, 14, 62, 63, 190, 191, 366]) {
      const range = { from: "2025-09-23", to: "2025-09-23" };
      const to = new Date(Date.UTC(2025, 8, 23 + days - 1)).toISOString().slice(0, 10);
      const points = bucketStarts({ from: range.from, to }, chartGranularity(days));
      expect(points.length).toBeLessThanOrEqual(63);
      expect(points.length).toBeGreaterThan(0);
    }
    expect(bucketStarts({ from: "2026-09-02", to: "2026-09-16" }, "week")).toEqual(["2026-08-31", "2026-09-07", "2026-09-14"]);
    expect(bucketStarts({ from: "2025-11-15", to: "2026-02-01" }, "month")).toEqual(["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]);
  });

  it("refuses a runtime timezone that differs from the build's", () => {
    expect(() => assertBusinessTimezoneConfig({}, "Asia/Jakarta")).not.toThrow();
    expect(() => assertBusinessTimezoneConfig({ BUSINESS_TIMEZONE: "Asia/Jakarta" }, "Asia/Jakarta")).not.toThrow();
    expect(() => assertBusinessTimezoneConfig({ BUSINESS_TIMEZONE: "Asia/Makassar" }, "Asia/Jakarta")).toThrow(BusinessTimezoneConfigError);
    expect(() => assertBusinessTimezoneConfig({}, "Mars/Olympus")).toThrow(BusinessTimezoneConfigError);
  });
});

describe("browse depth", () => {
  it("caps offset pagination at MAX_BROWSABLE_ROWS", () => {
    expect(pageWindow(100_000).offset).toBeLessThan(MAX_BROWSABLE_ROWS);
    expect(pageWindow(100_000, 100).offset).toBeLessThan(MAX_BROWSABLE_ROWS);
    expect(totalPageCount(2_000_000, 20)).toBe(MAX_BROWSABLE_ROWS / 20);
  });
});

describe("request bounds", () => {
  const line = { ingredientId: uuid(1), quantityPurchased: 1, purchaseUnit: "kg", conversionToBaseUnits: 1000, unitPurchaseCost: 1000 };

  it("bounds purchase receipts: line count, magnitudes, and a real date", () => {
    expect(purchaseInputSchema.safeParse({ purchaseDate: "2026-09-01", lines: [line] }).success).toBe(true);
    expect(purchaseInputSchema.safeParse({ purchaseDate: "2026-09-01", lines: Array(101).fill(line) }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ purchaseDate: "2026-09-01", lines: [{ ...line, unitPurchaseCost: 3_000_000_000 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ purchaseDate: "2026-09-01", lines: [{ ...line, quantityPurchased: 1e13 }] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ purchaseDate: "yesterday", lines: [line] }).success).toBe(false);
    expect(purchaseInputSchema.safeParse({ purchaseDate: "2026-09-01", lines: [line], idempotencyKey: "short" }).success).toBe(false);
  });

  it("bounds stock counts, recipes, expenses and modifier configuration", () => {
    const countLine = { ingredientId: uuid(1), countedQuantity: 5 };
    expect(stockCountInputSchema.safeParse({ lines: Array(501).fill(countLine) }).success).toBe(false);
    expect(recipeInputSchema.safeParse({ menuItemVariantId: uuid(1), lines: Array.from({ length: 51 }, (_, i) => ({ ingredientId: uuid(i + 2), quantityBaseUnits: 1 })) }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ category: "rent", amount: 3_000_000_000, expenseDate: "2026-09-01" }).success).toBe(false);
    expect(expenseInputSchema.safeParse({ category: "rent", amount: 1, expenseDate: "2026-02-30" }).success).toBe(false);
    expect(modifierGroupInputSchema.safeParse({ name: "Milk", minSelections: 3, maxSelections: 1 }).success).toBe(false);
    expect(itemModifierGroupsSchema.safeParse({ menuItemId: uuid(1), groupIds: ["not-a-uuid"] }).success).toBe(false);
    expect(itemModifierGroupsSchema.safeParse({ menuItemId: uuid(1), groupIds: Array.from({ length: 51 }, (_, i) => uuid(i)) }).success).toBe(false);
    expect(menuItemInputSchema.safeParse({ name: "X", basePrice: 1, displayOrder: 1e12 }).success).toBe(false);
  });
});

describe("idempotency payload hash", () => {
  it("ignores key order and the key itself, but not the content", () => {
    const a = payloadHash({ lines: [{ b: 1, a: 2 }], supplierId: "x", idempotencyKey: "k1" });
    const b = payloadHash({ supplierId: "x", lines: [{ a: 2, b: 1 }], idempotencyKey: "k2" });
    expect(a).toBe(b);
    expect(payloadHash({ supplierId: "x", lines: [{ a: 2, b: 2 }] })).not.toBe(a);
  });
});
