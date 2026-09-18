"use server";

import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { requireCurrentUser } from "@/lib/auth/current-user";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { getRequestMeta } from "@/lib/http/request-meta";
import { changePasswordInputSchema } from "@/lib/validation/account";
import { flattenZodErrors } from "@/lib/validation/form-errors";
import { changeOwnPassword, WrongPasswordError } from "@/server/services/account-service";
import { consumeRateLimit, RATE_LIMITS } from "@/server/services/rate-limit";

export type ChangePasswordState =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }
  | undefined;

/**
 * Any signed-in person may change their own password; there is no
 * permission to hold because the account is theirs.
 *
 * The current-password check is a credential check, so it shares the
 * per-account login throttle: guessing someone's password from inside a
 * stolen session is capped the same way as guessing it at the door.
 */
export async function changePasswordAction(
  _prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const user = await requireCurrentUser();
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return { ok: false, error: "Your session has expired. Sign in again." };

  const parsed = changePasswordInputSchema.safeParse({
    currentPassword: formData.get("currentPassword") ?? "",
    newPassword: formData.get("newPassword") ?? "",
    confirmPassword: formData.get("confirmPassword") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted fields.", fieldErrors: flattenZodErrors(parsed.error) };
  }

  if (!(await consumeRateLimit(db, { rule: RATE_LIMITS.loginAccount(), key: ["password-change", user.id] }))) {
    return { ok: false, error: "Too many attempts. Wait a few minutes and try again." };
  }

  try {
    await changeOwnPassword(db, { userId: user.id, businessId: user.businessId }, token, parsed.data, await getRequestMeta());
  } catch (error) {
    if (error instanceof WrongPasswordError) {
      return { ok: false, error: error.message, fieldErrors: { currentPassword: error.message } };
    }
    return { ok: false, error: "Could not change the password. Try again." };
  }
  return { ok: true };
}
