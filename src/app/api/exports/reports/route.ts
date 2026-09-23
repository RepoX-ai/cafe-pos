import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db, getPool } from "@/lib/db/client";
import { resolveReportDateRange, todayInBusinessTimezone } from "@/lib/dates/dates";
import { describeError, log } from "@/lib/observability/log";
import { ExportRejectedError, isReportType, openReportExport } from "@/server/services/report-exports";
import { toByteStream } from "@/server/services/export-stream";
import {
  claimRateLimitCleanupSlot,
  consumeRateLimit,
  deleteExpiredRateLimitBuckets,
  RATE_LIMITS,
} from "@/server/services/rate-limit";

/**
 * CSV exports for every major report (PRD §6.14). Every export re-checks
 * permission and scopes to the caller's business — this is a normal
 * authenticated route, not a public link. The file applies the same date
 * filters (and the same 366-day cap) as the report screen.
 *
 * Streaming is pull-based: the next batch is only read from PostgreSQL when
 * the client has taken the previous one, so memory stays at about one batch
 * however slowly the download is read. See `openReportExport` for the
 * consistency guarantee and the size/duration/concurrency limits.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !hasAnyRolePermission(user.roles, "reports:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "";
  if (!isReportType(type)) {
    return NextResponse.json({ error: "Unknown report type" }, { status: 400 });
  }
  const today = todayInBusinessTimezone();
  const { range } = resolveReportDateRange(url.searchParams.get("from"), url.searchParams.get("to"), { from: today, to: today });

  const rule = RATE_LIMITS.export();
  const allowed = await consumeRateLimit(db, { rule, key: [user.businessId, user.id] });
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many exports. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } },
    );
  }

  let chunks: AsyncGenerator<string, void, undefined>;
  try {
    ({ chunks } = await openReportExport(getPool("reports"), user.businessId, type, range));
  } catch (error) {
    if (error instanceof ExportRejectedError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status, headers: error.status === 429 ? { "Retry-After": "30" } : undefined },
      );
    }
    log("error", "export.open_failed", { type, businessId: user.businessId, ...describeError(error) });
    return NextResponse.json({ error: "The export could not be started. Try again." }, { status: 503 });
  }

  const stream = toByteStream(chunks, {
    signal: request.signal,
    onError: (error) => log("error", "export.stream_failed", { type, businessId: user.businessId, ...describeError(error) }),
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}_${range.from}_${range.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
