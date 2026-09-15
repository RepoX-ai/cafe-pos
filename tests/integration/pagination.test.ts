import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { getTestDb, seedTestFixture } from "./helpers";
import { listOrders } from "@/server/services/order-service";
import { listAuditLogs } from "@/server/services/audit";
import { pageWindow, toPage } from "@/lib/pagination";

const db = getTestDb();
afterAll(async () => db?.$client.end());

async function seedOrders(businessId: string, count: number, opts: { createdAt?: (i: number) => Date; status?: (i: number) => "SUBMITTED" | "CANCELLED" } = {}) {
  return db!
    .insert(schema.orders)
    .values(
      Array.from({ length: count }, (_, i) => ({
        businessId,
        orderNumber: `PG-${String(i + 1).padStart(5, "0")}`,
        idempotencyKey: randomUUID(),
        status: opts.status?.(i) ?? ("SUBMITTED" as const),
        total: 1_000,
        createdAt: opts.createdAt?.(i) ?? new Date(Date.parse("2026-05-01T00:00:00Z") + i * 60_000),
      })),
    )
    .returning();
}

async function walkOrders(businessId: string, filters: { status?: string; search?: string } = {}) {
  const rows: Awaited<ReturnType<typeof listOrders>>["rows"] = [];
  for (let page = 1; ; page++) {
    const result = await listOrders(db!, businessId, { ...filters, page });
    rows.push(...result.rows);
    if (!result.hasNextPage) return { rows, pages: page };
  }
}

describe.skipIf(!db)("server-side pagination (PostgreSQL)", () => {
  it("reaches every order past the old 100-row limit, newest first, even when timestamps tie", async () => {
    const { business } = await seedTestFixture(db!);
    const tie = new Date("2026-05-02T00:00:00Z");
    const seeded = await seedOrders(business.id, 130, { createdAt: (i) => (i < 60 ? tie : new Date(Date.parse("2026-05-01T00:00:00Z") + i * 60_000)) });

    const { rows, pages } = await walkOrders(business.id);

    expect(pages).toBe(7);
    expect(rows).toHaveLength(130);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(seeded.map((r) => r.id)));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].createdAt.getTime()).toBeGreaterThanOrEqual(rows[i].createdAt.getTime());
    }
  });

  it("returns an empty page, not an error, past the end", async () => {
    const { business } = await seedTestFixture(db!);
    await seedOrders(business.id, 25);
    expect(await listOrders(db!, business.id, { page: 2 })).toMatchObject({ page: 2, hasNextPage: false });
    const beyond = await listOrders(db!, business.id, { page: 9 });
    expect(beyond.rows).toHaveLength(0);
    expect(beyond.hasNextPage).toBe(false);
  });

  it("applies status and search filters before paging", async () => {
    const { business } = await seedTestFixture(db!);
    await seedOrders(business.id, 90, { status: (i) => (i % 3 === 0 ? "CANCELLED" : "SUBMITTED") });

    const cancelled = await walkOrders(business.id, { status: "CANCELLED" });
    expect(cancelled.rows).toHaveLength(30);
    expect(cancelled.rows.every((r) => r.status === "CANCELLED")).toBe(true);
    expect(cancelled.pages).toBe(2);

    const searched = await walkOrders(business.id, { search: "PG-0008" });
    expect(searched.rows.map((r) => r.orderNumber).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `PG-0008${i}`));
  });

  it("never pages into another business's orders", async () => {
    const a = await seedTestFixture(db!);
    const b = await seedTestFixture(db!);
    await seedOrders(a.business.id, 30);
    const others = await seedOrders(b.business.id, 30);
    const { rows } = await walkOrders(a.business.id);
    expect(rows).toHaveLength(30);
    const otherIds = new Set(others.map((o) => o.id));
    expect(rows.some((r) => otherIds.has(r.id))).toBe(false);
  });

  it("reaches audit events beyond the old 200-row screen", async () => {
    const { business } = await seedTestFixture(db!);
    await db!.insert(schema.auditLogs).values(
      Array.from({ length: 230 }, () => ({ businessId: business.id, action: "test.event", entityType: "test", createdAt: new Date("2026-05-03T00:00:00Z") })),
    );
    const ids = new Set<string>();
    for (let page = 1; ; page++) {
      const window = pageWindow(page);
      const result = toPage(await listAuditLogs(db!, business.id, window), window.page, window.pageSize);
      result.rows.forEach((r) => ids.add(r.id));
      if (!result.hasNextPage) break;
    }
    expect(ids.size).toBe(230);
  });
});
