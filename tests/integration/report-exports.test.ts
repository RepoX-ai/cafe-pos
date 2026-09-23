import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { seedTestFixture, getTestDb } from "./helpers";
import { ExportRejectedError, ExportTimeoutError, exportLimitsFromEnv, openReportExport, type ExportLimits } from "@/server/services/report-exports";
import { toByteStream } from "@/server/services/export-stream";

const db = getTestDb();
// A dedicated pool per file so connection accounting is exact.
const pool = process.env.TEST_DATABASE_URL ? new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 4 }) : null;

/** Counts the keyset batch queries the export issues (they are the ones with a LIMIT). */
let batchQueries = 0;
pool?.on("connect", (client) => {
  const original = client.query.bind(client) as (...args: unknown[]) => unknown;
  (client as { query: unknown }).query = (...args: unknown[]) => {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text ?? "";
    if (/\blimit\b/i.test(text) && /inventory_movements/i.test(text)) batchQueries++;
    return original(...args);
  };
});

afterAll(async () => {
  await Promise.all([db?.$client.end(), pool?.end()]);
});

const RANGE = { from: "2026-03-01", to: "2026-03-31" };
// Own slot namespace: the installation-wide slots are shared with every
// other test file exporting against this database at the same moment.
const SLOTS = 900_000 + Math.floor(Math.random() * 100_000);
const limits = (overrides: Partial<ExportLimits> = {}): ExportLimits => ({
  ...exportLimitsFromEnv(),
  batchSize: 50,
  maxConcurrent: 20,
  slotNamespace: SLOTS,
  ...overrides,
});

/** `count` movements inside RANGE for a fresh business, newest last. */
async function businessWithMovements(count: number) {
  const f = await seedTestFixture(db!);
  await db!.$client.query(
    `insert into inventory_movements (id, business_id, ingredient_id, movement_type, quantity_base_units, source_type, created_at)
     select gen_random_uuid(), $1, $2, 'MANUAL_ADJUSTMENT_IN', 1, 'manual_adjustment',
            timestamptz '2026-03-10 00:00:00+07' + (g * interval '1 second')
     from generate_series(1, $3::int) as g`,
    [f.business.id, f.ingredient.id, count],
  );
  return f;
}

async function readAll(chunks: AsyncGenerator<string, void, undefined>) {
  let text = "";
  for await (const chunk of chunks) text += chunk;
  const [header, ...rows] = text.split("\r\n");
  return { header, rows };
}

const checkedOut = () => pool!.totalCount - pool!.idleCount;

describe.skipIf(!db)("CSV export streaming (PostgreSQL)", () => {
  it("queries only as fast as the reader consumes", async () => {
    const f = await businessWithMovements(500);
    const { chunks, expectedRows } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits());
    expect(expectedRows).toBe(500);
    batchQueries = 0; // the capped row count above also has a LIMIT

    await chunks.next(); // header only
    expect(batchQueries).toBe(0);
    await chunks.next(); // first batch
    expect(batchQueries).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(batchQueries).toBe(1); // nothing read ahead while the reader stalls

    const rest = await readAll(chunks);
    expect(rest.rows.length + 50).toBe(500);
    expect(batchQueries).toBe(11); // ten full batches, then one empty probe
    expect(checkedOut()).toBe(0);
  });

  it("keeps the byte stream at most one batch ahead of the reader", async () => {
    let produced = 0;
    async function* gen() {
      for (let i = 0; i < 100; i++) {
        produced++;
        yield `chunk ${i}\n`;
      }
    }
    const reader = toByteStream(gen()).getReader();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(produced).toBeLessThanOrEqual(1);
    await reader.read();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(produced).toBeLessThanOrEqual(2);
    await reader.cancel();
  });

  it("releases the connection and the business slot when the reader cancels mid-export", async () => {
    const f = await businessWithMovements(300);
    const { chunks } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits());
    const reader = toByteStream(chunks).getReader();
    await reader.read();
    expect(checkedOut()).toBe(1);
    await reader.cancel();
    await expect.poll(checkedOut).toBe(0);

    // The per-business advisory lock went with the transaction.
    const again = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits());
    await again.chunks.return(undefined);
    expect(checkedOut()).toBe(0);
  });

  it("releases the connection when the abort signal fires", async () => {
    const f = await businessWithMovements(200);
    const controller = new AbortController();
    const { chunks } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits());
    const reader = toByteStream(chunks, { signal: controller.signal }).getReader();
    await reader.read();
    controller.abort();
    await expect.poll(checkedOut).toBe(0);
  });

  it("exports one consistent snapshot while rows are written concurrently", async () => {
    const f = await businessWithMovements(300);
    const { chunks, expectedRows } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits());
    await chunks.next();
    await chunks.next(); // snapshot taken, first batch out

    // Newer and older rows, inside the range, committed on another connection.
    await db!.$client.query(
      `insert into inventory_movements (id, business_id, ingredient_id, movement_type, quantity_base_units, source_type, created_at)
       select gen_random_uuid(), $1, $2, 'MANUAL_ADJUSTMENT_IN', 1, 'manual_adjustment', timestamptz '2026-03-05 00:00:00+07' + (g * interval '1 hour')
       from generate_series(1, 200) as g`,
      [f.business.id, f.ingredient.id],
    );

    const rest = await readAll(chunks);
    expect(expectedRows).toBe(300);
    expect(rest.rows.length + 50).toBe(300);
  });

  it("never skips rows that share a millisecond (microsecond cursor)", async () => {
    const f = await seedTestFixture(db!);
    await db!.$client.query(
      `insert into inventory_movements (id, business_id, ingredient_id, movement_type, quantity_base_units, source_type, created_at)
       select gen_random_uuid(), $1, $2, 'MANUAL_ADJUSTMENT_IN', g, 'manual_adjustment', timestamptz '2026-03-10 10:00:00.123000+07' + (g * interval '1 microsecond')
       from generate_series(1, 40) as g`,
      [f.business.id, f.ingredient.id],
    );
    // One batch, then batches of 3 whose cursors all fall inside the same millisecond.
    const all = await readAll((await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits({ batchSize: 50 }))).chunks);
    const paged = await readAll((await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits({ batchSize: 3 }))).chunks);
    expect(all.rows).toHaveLength(40);
    expect(paged.rows).toEqual(all.rows);
    expect(new Set(paged.rows.map((r) => r.split(",")[2])).size).toBe(40); // every quantity 1..40 exactly once
    expect(checkedOut()).toBe(0);
  });

  it("refuses an export over the row cap before sending anything, and releases the connection", async () => {
    const f = await businessWithMovements(120);
    await expect(openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits({ maxRows: 100 }))).rejects.toMatchObject({
      status: 413,
    });
    expect(checkedOut()).toBe(0);
  });

  it("allows one export per business and a bounded number overall", async () => {
    const a = await businessWithMovements(60);
    const b = await businessWithMovements(60);
    const first = await openReportExport(pool!, a.business.id, "inventory_movements", RANGE, limits({ maxConcurrent: 1 }));
    await expect(openReportExport(pool!, a.business.id, "inventory_movements", RANGE, limits({ maxConcurrent: 1 }))).rejects.toBeInstanceOf(
      ExportRejectedError,
    );
    await expect(openReportExport(pool!, b.business.id, "inventory_movements", RANGE, limits({ maxConcurrent: 1 }))).rejects.toThrow(
      "busy with other exports",
    );
    const second = await openReportExport(pool!, b.business.id, "inventory_movements", RANGE, limits({ maxConcurrent: 2 }));
    await Promise.all([first.chunks.return(undefined), second.chunks.return(undefined)]);
    expect(checkedOut()).toBe(0);
  });

  it("stops at the duration limit and releases the connection", async () => {
    const f = await businessWithMovements(200);
    const { chunks } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits({ maxDurationMs: 30 }));
    await chunks.next();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await expect(readAll(chunks)).rejects.toBeInstanceOf(ExportTimeoutError);
    expect(checkedOut()).toBe(0);
  });

  it("exports a large ledger completely, in order, exactly once", async () => {
    const f = await businessWithMovements(20_000);
    const { chunks } = await openReportExport(pool!, f.business.id, "inventory_movements", RANGE, limits({ batchSize: 1000 }));
    const { rows } = await readAll(chunks);
    expect(rows).toHaveLength(20_000);
    const when = rows.map((r) => r.split(",")[0]);
    expect([...when].sort().reverse()).toEqual(when);
    expect(checkedOut()).toBe(0);
  }, 60_000);
});
