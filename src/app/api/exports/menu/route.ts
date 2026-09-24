import { NextResponse, after } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { hasAnyRolePermission } from "@/lib/permissions/permissions";
import { db } from "@/lib/db/client";
import { buildMenuExportCsv } from "@/server/services/menu-bulk";
import { claimRateLimitCleanupSlot, consumeRateLimit, deleteExpiredRateLimitBuckets, RATE_LIMITS } from "@/server/services/rate-limit";
import { describeError, log } from "@/lib/observability/log";

/**
 * CSV export of the caller's own menu catalog — items, variants, and active
 * recipe lines, flattened one row per recipe line. Same shape the import
 * route (bulk-actions.ts) reads back, so editing this file and re-uploading
 * it is the bulk-update workflow. Menu catalogs are small (unlike the
 * reports export), so this just builds the whole CSV in memory rather than
 * streaming.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasAnyRolePermission(user.roles, "menu:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const rule = RATE_LIMITS.export();
  const allowed = await consumeRateLimit(db, { rule, key: [user.businessId, user.id] });
  if (claimRateLimitCleanupSlot()) after(() => deleteExpiredRateLimitBuckets(db).catch(() => undefined));
  if (!allowed) {
    return NextResponse.json(
      { error: "Too many exports. Wait a few minutes and try again." },
      { status: 429, headers: { "Retry-After": String(rule.windowSeconds) } },
    );
  }

  let csv: string;
  try {
    csv = await buildMenuExportCsv(db, user.businessId);
  } catch (error) {
    log("error", "menu_export.failed", { businessId: user.businessId, ...describeError(error) });
    return NextResponse.json({ error: "The export could not be built. Try again." }, { status: 503 });
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="menu.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
