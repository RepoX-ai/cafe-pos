import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getTestDb, seedTestFixture } from "./helpers";
import { hashPassword } from "@/lib/auth/password";
import { createSession, validateSessionToken } from "@/lib/auth/session";
import { login } from "@/server/services/auth-service";
import { changeOwnPassword } from "@/server/services/account-service";
import { auditLogs, users } from "@/lib/db/schema";

const db = getTestDb();

describe.skipIf(!db)("changing your own password", () => {
  it("rotates the hash, keeps this session, signs out the others, and logs it", async () => {
    const { business, user, membership } = await seedTestFixture(db!);
    await db!.update(users).set({ passwordHash: await hashPassword("OldPassword123!") }).where(eq(users.id, user.id));

    const here = await createSession(db!, user.id, membership.id);
    const phone = await createSession(db!, user.id, membership.id);

    await changeOwnPassword(db!, { userId: user.id, businessId: business.id }, here.token, {
      currentPassword: "OldPassword123!",
      newPassword: "NewPassphrase2026!",
      confirmPassword: "NewPassphrase2026!",
    });

    // The device that made the change stays in; the other one is out.
    expect(await validateSessionToken(db!, here.token)).not.toBeNull();
    expect(await validateSessionToken(db!, phone.token)).toBeNull();

    // Old password no longer works at the door; the new one does.
    expect(await login(db!, user.email, "OldPassword123!")).toMatchObject({ ok: false, error: "invalid_credentials" });
    expect(await login(db!, user.email, "NewPassphrase2026!")).toMatchObject({ ok: true });

    const [logged] = await db!
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, user.id), eq(auditLogs.action, "user.password_changed")));
    expect(logged.businessId).toBe(business.id);
  });

  it("refuses without the current password, and changes nothing", async () => {
    const { business, user, membership } = await seedTestFixture(db!);
    await db!.update(users).set({ passwordHash: await hashPassword("OldPassword123!") }).where(eq(users.id, user.id));
    const here = await createSession(db!, user.id, membership.id);
    const phone = await createSession(db!, user.id, membership.id);

    await expect(
      changeOwnPassword(db!, { userId: user.id, businessId: business.id }, here.token, {
        currentPassword: "not-the-password",
        newPassword: "NewPassphrase2026!",
        confirmPassword: "NewPassphrase2026!",
      }),
    ).rejects.toThrow("Current password is incorrect");

    expect(await login(db!, user.email, "OldPassword123!")).toMatchObject({ ok: true });
    expect(await validateSessionToken(db!, phone.token)).not.toBeNull();
  });
});
