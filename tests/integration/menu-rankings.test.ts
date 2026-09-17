import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { businessDayBounds } from "@/lib/dates/dates";
import { getTestDb, seedTestFixture } from "./helpers";
import {
  clampRankingLimit,
  getSalesByMenuItem,
  getTopMenuItemRankings,
  MENU_RANKING_MAX_LIMIT,
} from "@/server/services/reports-service";

/**
 * Dashboard rankings are checked against `getSalesByMenuItem` — the full,
 * unchanged report — sorted the way the dashboard used to sort it, so "top
 * selling" and "highest COGS" provably keep their meaning. Orders and lines
 * are inserted directly so snapshots, ties, statuses and timestamps are
 * exactly controlled.
 */
const db = getTestDb();

const RANGE = { from: "2026-03-10", to: "2026-03-11" };
const { start, endExclusive } = businessDayBounds(RANGE);
const inRange = new Date(start.getTime() + 60 * 60 * 1000);

type Line = { menuItemId: string | null; name: string; quantity: number; lineTotal: number; cogs: number };

async function business() {
  const fixture = await seedTestFixture(db!);
  const items = await db!
    .insert(schema.menuItems)
    .values(["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf"].map((name) => ({ businessId: fixture.business.id, name, basePrice: 1 })))
    .returning();
  const id = Object.fromEntries(items.map((i) => [i.name, i.id])) as Record<string, string>;
  return { businessId: fixture.business.id, id };
}

async function order(
  businessId: string,
  lines: Line[],
  opts: { status?: (typeof schema.orderStatusEnum.enumValues)[number]; createdAt?: Date } = {},
) {
  const [row] = await db!
    .insert(schema.orders)
    .values({
      businessId,
      orderNumber: `R-${randomUUID().slice(0, 8)}`,
      idempotencyKey: randomUUID(),
      status: opts.status ?? "SUBMITTED",
      createdAt: opts.createdAt ?? inRange,
    })
    .returning();
  await db!.insert(schema.orderLines).values(
    lines.map((l) => ({
      orderId: row.id,
      menuItemId: l.menuItemId,
      itemNameSnapshot: l.name,
      quantity: l.quantity,
      unitPriceSnapshot: Math.round(l.lineTotal / l.quantity),
      lineTotal: l.lineTotal,
      cogsSnapshot: l.cogs,
      grossProfitSnapshot: l.lineTotal - l.cogs,
    })),
  );
  return row;
}

const line = (menuItemId: string | null, name: string, quantity: number, cogs: number, lineTotal = quantity * 10_000): Line => ({
  menuItemId,
  name,
  quantity,
  lineTotal,
  cogs,
});

/** What the dashboard computed before: full report, sorted in JS, sliced. */
async function oracle(businessId: string, limit: number) {
  const all = await getSalesByMenuItem(db!, businessId, RANGE);
  const tie = (a: (typeof all)[number], b: (typeof all)[number]) =>
    a.name.localeCompare(b.name, "en", { sensitivity: "variant" }) || String(a.menuItemId).localeCompare(String(b.menuItemId));
  return {
    all,
    topSelling: [...all].sort((a, b) => b.quantitySold - a.quantitySold || tie(a, b)).slice(0, limit),
    highestCogs: [...all].sort((a, b) => b.cogs - a.cogs || tie(a, b)).slice(0, limit),
  };
}

describe.skipIf(!db)("dashboard menu rankings (integration)", () => {
  it("ranks by units sold and by total COGS, matching the full report", async () => {
    const { businessId, id } = await business();
    await order(businessId, [line(id.Alpha, "Alpha", 10, 5_000), line(id.Bravo, "Bravo", 2, 90_000)]);
    await order(businessId, [line(id.Charlie, "Charlie", 7, 20_000), line(id.Alpha, "Alpha", 1, 500)]);
    await order(businessId, [line(id.Delta, "Delta", 3, 60_000), line(id.Echo, "Echo", 8, 1_000)]);
    await order(businessId, [line(id.Foxtrot, "Foxtrot", 1, 70_000), line(id.Golf, "Golf", 4, 30_000)]);

    const rankings = await getTopMenuItemRankings(db!, businessId, RANGE, 3);
    const expected = await oracle(businessId, 3);

    expect(rankings.topSelling.map((r) => [r.name, r.quantitySold])).toEqual([
      ["Alpha", 11],
      ["Echo", 8],
      ["Charlie", 7],
    ]);
    expect(rankings.highestCogs.map((r) => [r.name, r.cogs])).toEqual([
      ["Bravo", 90_000],
      ["Foxtrot", 70_000],
      ["Delta", 60_000],
    ]);
    expect(rankings.topSelling).toEqual(expected.topSelling);
    expect(rankings.highestCogs).toEqual(expected.highestCogs);
    // Every aggregate is a plain JS number, summed exactly.
    expect(rankings.topSelling[0]).toEqual({ menuItemId: id.Alpha, name: "Alpha", quantitySold: 11, revenue: 110_000, cogs: 5_500, grossProfit: 104_500 });

    // The full report is not truncated by any of this.
    expect(expected.all).toHaveLength(7);
  });

  it("breaks ties deterministically by name, then id", async () => {
    const { businessId, id } = await business();
    // Same units and same COGS for all four, inserted out of name order.
    await order(businessId, [line(id.Delta, "Delta", 5, 1_000), line(id.Bravo, "Bravo", 5, 1_000)]);
    await order(businessId, [line(id.Charlie, "Charlie", 5, 1_000), line(id.Alpha, "Alpha", 5, 1_000)]);

    for (let i = 0; i < 3; i++) {
      const { topSelling, highestCogs } = await getTopMenuItemRankings(db!, businessId, RANGE, 3);
      expect(topSelling.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
      expect(highestCogs.map((r) => r.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
    }
  });

  it("returns no more than the limit per ranking, and clamps bad limits", async () => {
    const { businessId, id } = await business();
    await order(businessId, Object.entries(id).map(([name, itemId], i) => line(itemId, name, i + 1, (7 - i) * 1_000)));

    const five = await getTopMenuItemRankings(db!, businessId, RANGE, 5);
    expect(five.topSelling).toHaveLength(5);
    expect(five.highestCogs).toHaveLength(5);
    expect((await getTopMenuItemRankings(db!, businessId, RANGE, 0)).topSelling).toHaveLength(1);
    expect((await getTopMenuItemRankings(db!, businessId, RANGE, Number.NaN)).highestCogs).toHaveLength(1);
    expect((await getTopMenuItemRankings(db!, businessId, RANGE, 10_000)).topSelling).toHaveLength(7);

    expect(clampRankingLimit(-3)).toBe(1);
    expect(clampRankingLimit(2.9)).toBe(2);
    expect(clampRankingLimit(Number.POSITIVE_INFINITY)).toBe(1);
    expect(clampRankingLimit(10_000)).toBe(MENU_RANKING_MAX_LIMIT);
  });

  it("is empty when nothing sold in range", async () => {
    const { businessId } = await business();
    expect(await getTopMenuItemRankings(db!, businessId, RANGE, 5)).toEqual({ topSelling: [], highestCogs: [] });
  });

  it("only counts active orders of this business within the business-day bounds", async () => {
    const { businessId, id } = await business();
    const other = await business();
    await order(businessId, [line(id.Alpha, "Alpha", 1, 100)], { createdAt: start }); // first instant: in
    await order(businessId, [line(id.Alpha, "Alpha", 50, 99_000)], { createdAt: endExclusive }); // end: out
    await order(businessId, [line(id.Alpha, "Alpha", 50, 99_000)], { createdAt: new Date(start.getTime() - 1) }); // before: out
    await order(businessId, [line(id.Bravo, "Bravo", 40, 80_000)], { status: "CANCELLED" });
    await order(businessId, [line(id.Charlie, "Charlie", 30, 70_000)], { status: "REFUNDED" });
    await order(businessId, [line(id.Delta, "Delta", 2, 200)], { status: "COMPLETED" });
    await order(other.businessId, [line(other.id.Echo, "Echo", 99, 999_000)]);

    const { topSelling, highestCogs } = await getTopMenuItemRankings(db!, businessId, RANGE, 5);
    expect(topSelling.map((r) => [r.name, r.quantitySold])).toEqual([
      ["Delta", 2],
      ["Alpha", 1],
    ]);
    expect(highestCogs.map((r) => [r.name, r.cogs])).toEqual([
      ["Delta", 200],
      ["Alpha", 100],
    ]);
    expect(topSelling).toEqual((await oracle(businessId, 5)).topSelling);
  });

  it("keeps a deleted menu item as its own row under its snapshot name", async () => {
    const { businessId, id } = await business();
    await order(businessId, [line(null, "Retired latte", 9, 45_000), line(null, "Old muffin", 3, 2_000), line(id.Alpha, "Alpha", 4, 8_000)]);

    const { topSelling, highestCogs } = await getTopMenuItemRankings(db!, businessId, RANGE, 5);
    expect(topSelling.map((r) => [r.menuItemId, r.name, r.quantitySold])).toEqual([
      [null, "Retired latte", 9],
      [id.Alpha, "Alpha", 4],
      [null, "Old muffin", 3],
    ]);
    expect(highestCogs[0]).toMatchObject({ menuItemId: null, name: "Retired latte", cogs: 45_000 });
    const expected = await oracle(businessId, 5);
    expect(topSelling).toEqual(expected.topSelling);
    expect(highestCogs).toEqual(expected.highestCogs);
  });
});
