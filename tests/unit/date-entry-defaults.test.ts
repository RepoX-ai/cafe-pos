import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { todayInBusinessTimezone } from "@/lib/dates/dates";

/**
 * Date fields default to "today" in the café's timezone. Between 00:00 and
 * 06:59 WIB the UTC date is still yesterday, so a UTC-derived default put
 * expenses and supplier payments on the previous day.
 */

afterEach(() => {
  vi.useRealTimers();
});

describe("todayInBusinessTimezone", () => {
  it("is already the new day at 00:30 WIB, while the UTC date is still yesterday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-27T17:30:00Z")); // 28 Sep 00:30 WIB
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-27");
    expect(todayInBusinessTimezone()).toBe("2026-09-28");
  });

  it("is the last day right up to 23:59 WIB", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T16:59:59Z")); // 28 Sep 23:59:59 WIB
    expect(todayInBusinessTimezone()).toBe("2026-09-28");
  });

  it("agrees with the UTC date during the day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T05:00:00Z")); // 28 Sep 12:00 WIB
    expect(todayInBusinessTimezone()).toBe("2026-09-28");
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-09-28");
  });

  it("does not depend on the runtime's own timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-12-31T17:30:00Z")); // 1 Jan 2027 00:30 WIB
    const original = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      expect(todayInBusinessTimezone()).toBe("2027-01-01");
    } finally {
      process.env.TZ = original;
    }
  });
});

describe("date-entry defaults", () => {
  const SRC = path.resolve(__dirname, "../../src");
  // Pure calendar arithmetic on dates that are already UTC-anchored Y-M-D values.
  const ALLOWED = new Set(["lib/dates/dates.ts", "components/ui/calendar-utils.ts"]);

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) return sourceFiles(full);
      return /\.(ts|tsx)$/.test(name) ? [full] : [];
    });
  }

  it("never derive a calendar date from the UTC clock outside the date helpers", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
      .filter((rel) => !ALLOWED.has(rel))
      .filter((rel) => /toISOString\(\)\s*\.\s*(slice\(\s*0\s*,\s*10\s*\)|split\(\s*["']T["']\s*\))/.test(readFileSync(path.join(SRC, rel), "utf8")));
    expect(offenders).toEqual([]);
  });
});
