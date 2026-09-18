import { z } from "zod";

/** Same floor as create-owner; the dev seed password is exactly this long. */
export const MIN_PASSWORD_LENGTH = 12;
// Well above any real passphrase, so an oversized body can't be pushed
// through bcrypt.
const MAX_PASSWORD_LENGTH = 1024;

export const changePasswordInputSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password").max(MAX_PASSWORD_LENGTH),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(MAX_PASSWORD_LENGTH),
    confirmPassword: z.string().max(MAX_PASSWORD_LENGTH),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    path: ["confirmPassword"],
    message: "The two new passwords don't match",
  })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ["newPassword"],
    message: "Choose a password you haven't used here before",
  });

export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;
