"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { SESSION_COOKIE_NAME, setActiveMembership } from "@/lib/auth/session";
import { recordAuditLog } from "@/server/services/audit";
import { getRequestMeta } from "@/lib/http/request-meta";

export type SwitchBusinessResult = { ok: true } | { ok: false; error: string };

/**
 * Moves the current session into another business the signed-in user is a
 * member of.
 *
 * The membership id arrives from the client, so it is never trusted:
 * `setActiveMembership` re-checks that it belongs to *this* session's user
 * and is still active before anything moves. A membership id belonging to
 * someone else is simply "not found" — the same answer as one that doesn't
 * exist, so this can't be used to probe which ids are real.
 *
 * Both businesses get an audit line. The one being left records who walked
 * out, and the one being entered records who walked in; reading either
 * café's log alone would otherwise show a session appearing from nowhere.
 */
export async function switchBusinessAction(membershipId: string): Promise<SwitchBusinessResult> {
  const user = await requireCurrentUser();

  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { ok: false, error: "Your session has expired. Sign in again." };

  if (typeof membershipId !== "string" || membershipId.length === 0) {
    return { ok: false, error: "Pick a business to switch to." };
  }
  if (membershipId === user.membershipId) return { ok: true };

  const previousBusinessId = user.businessId;
  // The business comes back from the write itself rather than from the id
  // we were handed, so the audit lines name where the session actually
  // ended up. Re-reading the session here would not do: getCurrentUser is
  // memoised per render and would hand back the pre-switch value.
  const switched = await setActiveMembership(db, user.id, membershipId, token);
  if (!switched) {
    return { ok: false, error: "You don't have access to that business." };
  }

  const meta = await getRequestMeta();

  await recordAuditLog(db, {
    businessId: previousBusinessId,
    actorUserId: user.id,
    action: "business.switched_away",
    entityType: "business",
    entityId: switched.businessId,
    ...meta,
  });
  await recordAuditLog(db, {
    businessId: switched.businessId,
    actorUserId: user.id,
    action: "business.switched_to",
    entityType: "business",
    entityId: previousBusinessId,
    ...meta,
  });

  revalidatePath("/", "layout");
  return { ok: true };
}
