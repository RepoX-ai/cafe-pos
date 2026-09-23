import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Mixed workload against the seeded perf database: POS checkouts through the
 * real service (`submitOrderForUser`, app pool) while dashboards and CSV
 * exports run on the reports pool. Three phases — checkout alone, mixed, and
 * mixed with the reporting on the app pool (the pre-fix arrangement) — so
 * the effect of reporting on checkout, and of the pool split, is visible.
 *
 *   PERF_DATABASE_URL=.../cafe_pos_perf npm run test:perf
 *   Optional: PERF_PHASE_SECONDS (45), PERF_TABLETS (6), PERF_DASHBOARDS (2), PERF_EXPORTS (1)
 *
 * This measures the service layer and database on this machine. It does not
 * include HTTP, Next.js rendering, TLS or network latency to the tablets.
 */
const url = process.env.PERF_DATABASE_URL;
const PHASE_MS = Number(process.env.PERF_PHASE_SECONDS ?? 45) * 1000;
const TABLETS = Number(process.env.PERF_TABLETS ?? 6);
const DASHBOARDS = Number(process.env.PERF_DASHBOARDS ?? 2);
const EXPORTS = Number(process.env.PERF_EXPORTS ?? 1);

type Services = {
  submitOrderForUser: typeof import("@/server/services/checkout").submitOrderForUser;
  reports: typeof import("@/server/services/reports-service");
  openReportExport: typeof import("@/server/services/report-exports").openReportExport;
  exportLimitsFromEnv: typeof import("@/server/services/report-exports").exportLimitsFromEnv;
  db: typeof import("@/lib/db/client").db;
  reportDb: typeof import("@/lib/db/client").reportDb;
  getPool: typeof import("@/lib/db/client").getPool;
  dates: typeof import("@/lib/dates/dates");
};
let s: Services;
let monitor: Pool;

interface Catalog {
  businessId: string;
  userId: string;
  lines: Array<{ menuItemId: string; variantId: string; optionIds: string[] }>;
}
const catalogs: Catalog[] = [];

beforeAll(async () => {
  if (!url) return;
  // The services read DATABASE_URL (and pool settings) when first used.
  process.env.DATABASE_URL = url;
  s = {
    submitOrderForUser: (await import("@/server/services/checkout")).submitOrderForUser,
    reports: await import("@/server/services/reports-service"),
    openReportExport: (await import("@/server/services/report-exports")).openReportExport,
    exportLimitsFromEnv: (await import("@/server/services/report-exports")).exportLimitsFromEnv,
    ...(await import("@/lib/db/client")),
    dates: await import("@/lib/dates/dates"),
  };
  monitor = new Pool({ connectionString: url, max: 2, application_name: "perf-monitor" });

  const { rows: businesses } = await monitor.query<{ id: string; user_id: string }>(
    `select b.id, m.user_id from businesses b join memberships m on m.business_id = b.id order by b.name limit 3`,
  );
  for (const b of businesses) {
    const { rows } = await monitor.query<{ item: string; variant: string; group_id: string | null }>(
      `select i.id as item, v.id as variant, a.modifier_group_id as group_id
       from menu_items i join menu_item_variants v on v.menu_item_id = i.id
       left join menu_item_modifier_groups a on a.menu_item_id = i.id
       where i.business_id = $1 and i.active and v.active`,
      [b.id],
    );
    const { rows: options } = await monitor.query<{ id: string; group_id: string }>(
      `select o.id, o.modifier_group_id as group_id from modifier_options o join modifier_groups g on g.id = o.modifier_group_id where g.business_id = $1`,
      [b.id],
    );
    catalogs.push({
      businessId: b.id,
      userId: b.user_id,
      lines: rows.map((r) => ({ menuItemId: r.item, variantId: r.variant, optionIds: options.filter((o) => o.group_id === r.group_id).map((o) => o.id) })),
    });
  }
});

afterAll(async () => {
  await monitor?.end();
  if (s) await Promise.all([s.getPool("app").end(), s.getPool("reports").end()]);
});

function percentile(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function summarize(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (n: number) => Math.round(n * 10) / 10;
  return { n: sorted.length, p50: round(percentile(sorted, 50)), p95: round(percentile(sorted, 95)), p99: round(percentile(sorted, 99)), max: round(sorted.at(-1) ?? 0) };
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

async function runPhase(name: string, withReporting: boolean, reportingPool: "reports" | "app" = "reports") {
  const rdb = reportingPool === "reports" ? s.reportDb : s.db;
  const deadline = Date.now() + PHASE_MS;
  const checkoutMs: number[] = [];
  const dashboardMs: number[] = [];
  const exportMs: number[] = [];
  const errors: Record<string, number> = {};
  const note = (kind: string) => (errors[kind] = (errors[kind] ?? 0) + 1);
  const samples = { appWaiting: [] as number[], reportWaiting: [] as number[], lockWaiters: [] as number[], rssMb: [] as number[], heapMb: [] as number[] };
  const unlimited = { name: `perf-${randomUUID()}`, limit: 1_000_000, windowSeconds: 60 };

  const sampler = setInterval(() => {
    samples.appWaiting.push(s.getPool("app").waitingCount);
    samples.reportWaiting.push(s.getPool("reports").waitingCount);
    const mem = process.memoryUsage();
    samples.rssMb.push(mem.rss / 1048576);
    samples.heapMb.push(mem.heapUsed / 1048576);
  }, 50);
  let lockSampling = true;
  const lockSampler = (async () => {
    while (lockSampling) {
      const { rows } = await monitor.query<{ n: number }>(
        `select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and application_name like 'cafe-pos%'`,
      );
      samples.lockWaiters.push(rows[0].n);
      await new Promise((r) => setTimeout(r, 100));
    }
  })();

  const tablet = async (i: number) => {
    const catalog = catalogs[i % catalogs.length];
    const user = { id: catalog.userId, businessId: catalog.businessId, roles: ["cashier" as const] };
    while (Date.now() < deadline) {
      const lines = Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => {
        const l = pick(catalog.lines);
        const optionIds = l.optionIds.length && Math.random() < 0.5 ? [pick(l.optionIds)] : [];
        return { menuItemId: l.menuItemId, menuItemVariantId: l.variantId, quantity: 1 + Math.floor(Math.random() * 2), modifierOptionIds: optionIds };
      });
      // De-duplicate identical lines' modifiers (validation requires unique ids per line).
      const input = { idempotencyKey: randomUUID(), orderType: "dine_in", paymentMethodLabel: "cash", lines };
      const started = performance.now();
      try {
        const result = await s.submitOrderForUser(s.db, user, input, { checkoutRule: unlimited });
        checkoutMs.push(performance.now() - started);
        if (!result.ok) note(`checkout:${result.error.slice(0, 40)}`);
        // An occasional lost-response retry of the same key.
        if (Math.random() < 0.05) {
          const retry = await s.submitOrderForUser(s.db, user, input, { checkoutRule: unlimited, retryRule: unlimited });
          if (!retry.ok || !retry.idempotent) note("checkout:retry-not-idempotent");
        }
      } catch (error) {
        checkoutMs.push(performance.now() - started);
        note(`checkout-throw:${(error as Error).name}:${((error as { cause?: { code?: string } }).cause?.code) ?? ""}`);
      }
      await new Promise((r) => setTimeout(r, Math.random() * 150));
    }
  };

  const dashboard = async (i: number) => {
    const { businessId } = catalogs[i % catalogs.length];
    const today = s.dates.todayInBusinessTimezone();
    const range = { from: s.dates.shiftBusinessDate(today, -29), to: today };
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        await Promise.all([
          s.reports.getSalesSummary(rdb, businessId, range),
          s.reports.getSalesSummary(rdb, businessId, s.dates.previousBusinessPeriod(range)),
          s.reports.getStockAlerts(rdb, businessId, 6),
          s.reports.getTopMenuItemRankings(rdb, businessId, range, 5),
          s.reports.getRecentOrders(rdb, businessId, 8),
          s.reports.getFailedPrintJobs(rdb, businessId),
          s.reports.getSalesTrend(rdb, businessId, range, "day"),
          s.reports.getSalesByCategoryWithModifiers(rdb, businessId, range),
          s.reports.getSalesByPaymentMethod(rdb, businessId, range),
        ]);
        dashboardMs.push(performance.now() - started);
      } catch (error) {
        note(`dashboard:${(error as Error).name}`);
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  };

  const exporter = async (i: number) => {
    const { businessId } = catalogs[i % catalogs.length];
    const today = s.dates.todayInBusinessTimezone();
    const range = { from: s.dates.shiftBusinessDate(today, -6), to: today };
    while (Date.now() < deadline) {
      const started = performance.now();
      try {
        const { chunks } = await s.openReportExport(s.getPool(reportingPool), businessId, "inventory_movements", range, s.exportLimitsFromEnv());
        let bytes = 0;
        for await (const chunk of chunks) {
          bytes += chunk.length;
          // A slow-ish reader: a pause between batches.
          await new Promise((r) => setTimeout(r, 20));
        }
        exportMs.push(performance.now() - started);
        if (bytes === 0) note("export:empty");
      } catch (error) {
        note(`export:${(error as Error).message.slice(0, 40)}`);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  };

  const phaseStart = new Date();
  const { rows: before } = await monitor.query<{ id: string; q: string }>(
    `select id, current_quantity_base_units as q from ingredients where business_id = any($1)`,
    [catalogs.map((c) => c.businessId)],
  );
  await Promise.all([
    ...Array.from({ length: TABLETS }, (_, i) => tablet(i)),
    ...(withReporting ? Array.from({ length: DASHBOARDS }, (_, i) => dashboard(i)) : []),
    ...(withReporting ? Array.from({ length: EXPORTS }, (_, i) => exporter(i)) : []),
  ]);
  clearInterval(sampler);
  lockSampling = false;
  await lockSampler;

  // Ledger consistency under concurrency: each ingredient's change equals
  // the sum of the movements written during the phase.
  const { rows: drift } = await monitor.query<{ n: number }>(
    `select count(*)::int as n from ingredients i
     join (select unnest($1::uuid[]) as id, unnest($2::numeric[]) as q) b on b.id = i.id
     left join (select ingredient_id, sum(quantity_base_units) as moved from inventory_movements where created_at >= $3 group by ingredient_id) m on m.ingredient_id = i.id
     where i.current_quantity_base_units - b.q <> coalesce(m.moved, 0)`,
    [before.map((r) => r.id), before.map((r) => r.q), phaseStart],
  );

  const result = {
    phase: name,
    reportingPool: withReporting ? reportingPool : null,
    seconds: PHASE_MS / 1000,
    tablets: TABLETS,
    dashboards: withReporting ? DASHBOARDS : 0,
    exports: withReporting ? EXPORTS : 0,
    checkout: { ...summarize(checkoutMs), perSecond: Math.round((checkoutMs.length / (PHASE_MS / 1000)) * 10) / 10 },
    dashboard: summarize(dashboardMs),
    export: summarize(exportMs),
    errors,
    errorRate: checkoutMs.length ? Math.round((Object.entries(errors).filter(([k]) => k.startsWith("checkout")).reduce((n, [, v]) => n + v, 0) / checkoutMs.length) * 10000) / 100 : 0,
    appPoolWaiting: { max: Math.max(0, ...samples.appWaiting), meanX100: Math.round((samples.appWaiting.reduce((a, b) => a + b, 0) / Math.max(1, samples.appWaiting.length)) * 100) },
    reportPoolWaiting: { max: Math.max(0, ...samples.reportWaiting) },
    lockWaiters: { max: Math.max(0, ...samples.lockWaiters), samplesWithWaiters: samples.lockWaiters.filter((n) => n > 0).length, samples: samples.lockWaiters.length },
    memoryMb: { rssMax: Math.round(Math.max(...samples.rssMb)), heapMax: Math.round(Math.max(...samples.heapMb)) },
    ledgerDriftIngredients: drift[0].n,
  };
  return result;
}

describe.skipIf(!url)("mixed workload", () => {
  it("measures checkout alone, then alongside dashboards and exports", async () => {
    const { rows: [dataset] } = await monitor.query(
      `select (select count(*) from businesses) as businesses, (select count(*) from orders) as orders, (select count(*) from inventory_movements) as movements, version() as pg`,
    );
    const environment = {
      node: process.version,
      platform: `${os.platform()} ${os.release()}`,
      cpus: `${os.cpus().length} x ${os.cpus()[0]?.model}`,
      memoryGb: Math.round(os.totalmem() / 1073741824),
      pools: { app: s.getPool("app").options.max, reports: s.getPool("reports").options.max },
      dataset,
    };
    const alone = await runPhase("checkout-only", false);
    const mixed = await runPhase("mixed", true);
    // The pre-fix arrangement, for comparison: the same reporting load on the
    // pool checkout uses.
    const shared = await runPhase("mixed, reporting on the app pool (pre-fix)", true, "app");
    const report = { environment, phases: [alone, mixed, shared] };
    mkdirSync("perf-results", { recursive: true });
    writeFileSync(`perf-results/mixed-workload-${Date.now()}.json`, JSON.stringify(report, null, 2));
    expect(alone.ledgerDriftIngredients).toBe(0);
    expect(mixed.ledgerDriftIngredients).toBe(0);
    expect(shared.ledgerDriftIngredients).toBe(0);
  });
});
