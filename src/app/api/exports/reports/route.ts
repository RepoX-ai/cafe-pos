import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { resolveBusinessDateRange, todayInBusinessTimezone } from "@/lib/dates/dates";
import { isReportType, writeReportCsv } from "@/server/services/report-exports";
import {
  claimRateLimitCleanupSlot,
  consumeRateLimit,
  deleteExpiredRateLimitBuckets,
  RATE_LIMITS,
} from "@/server/services/rate-limit";

/**
 * CSV exports for every major report (PRD §6.14). Every export re-checks
 * permission and scopes to the caller's business — this is a normal
 * authenticated route, not a public link. The response streams the complete
 * result set, applying the same date filters as the report screen.
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
  const range = resolveBusinessDateRange(url.searchParams.get("from"), url.searchParams.get("to"), { from: today, to: today });

  const rule = RATE_LIMITS.export();
  const allowed = await consumeRateLimit(db, { rule, key: [user.businessId, user.id] });
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many exports. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } },
    );
  }

  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        await writeReportCsv(db, user.businessId, type, range, (chunk) => {
          if (cancelled) throw new Error("Export cancelled by the client");
          controller.enqueue(encoder.encode(chunk));
        });
        controller.close();
      } catch (error) {
        if (!cancelled) controller.error(error);
      }
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${type}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
