import { eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { invalidateOtherUserSessions } from "@/lib/auth/session";
import type { ChangePasswordInput } from "@/lib/validation/account";
import { recordAuditLog } from "./audit";

export class WrongPasswordError extends Error {
  constructor() {
    super("Current password is incorrect.");
    this.name = "WrongPasswordError";
  }
}

/**
 * A signed-in person changing their own password.
 *
 * This is the one write to `users` that is always allowed regardless of
 * memberships, because it is the account holder acting on their own
 * account — the staff screen's rule that a shared account's password is
 * "not yours to reset" is about *other* people's accounts. It is also the
 * only way a sole Owner can rotate their password at all.
 *
 * Proves possession of the current password first. On success every
 * other session of this user is dropped, so a device still holding the
 * old password is signed out; the session that made the change is kept.
 */
export async function changeOwnPassword(
  db: Database,
  actor: { userId: string; businessId: string },
  currentSessionToken: string,
  input: ChangePasswordInput,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
  if (!user) throw new Error("User not found");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw new WrongPasswordError();
  }

  const passwordHash = await hashPassword(input.newPassword);

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, actor.userId));
    await invalidateOtherUserSessions(tx, actor.userId, currentSessionToken);
    await recordAuditLog(tx, {
      businessId: actor.businessId,
      actorUserId: actor.userId,
      action: "user.password_changed",
      entityType: "user",
      entityId: actor.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  });
}
