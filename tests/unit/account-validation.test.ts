import { describe, expect, it } from "vitest";
import { changePasswordInputSchema, MIN_PASSWORD_LENGTH } from "@/lib/validation/account";

const good = { currentPassword: "OldPassword123!", newPassword: "NewPassphrase2026!", confirmPassword: "NewPassphrase2026!" };
const field = (input: unknown) => {
  const r = changePasswordInputSchema.safeParse(input);
  return r.success ? null : r.error.issues.map((i) => i.path.join(".")).sort();
};

describe("changePasswordInputSchema", () => {
  it("accepts a proper change", () => {
    expect(changePasswordInputSchema.safeParse(good).success).toBe(true);
  });

  it("requires the current password, so a stolen session alone is not enough", () => {
    expect(field({ ...good, currentPassword: "" })).toEqual(["currentPassword"]);
  });

  it("enforces the same length floor as the owner script", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(field({ ...good, newPassword: short, confirmPassword: short })).toEqual(["newPassword"]);
  });

  it("points a mismatch at the confirmation field", () => {
    expect(field({ ...good, confirmPassword: "Something-else-entirely" })).toEqual(["confirmPassword"]);
  });

  it("refuses re-using the current password", () => {
    expect(field({ ...good, newPassword: good.currentPassword, confirmPassword: good.currentPassword })).toEqual(["newPassword"]);
  });
});
