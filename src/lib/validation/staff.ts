import { z } from "zod";

export const ROLE_NAMES = ["owner", "manager", "cashier", "inventory_staff", "viewer"] as const;
// super_admin is deliberately excluded from self-service staff creation —
// it's a system-level role assigned out of band, not something an Owner
// grants from this screen (PRD §4: "should be used sparingly").

export const createStaffInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  email: z.string().trim().email("Enter a valid email").toLowerCase(),
  role: z.enum(ROLE_NAMES),
});

export type CreateStaffInput = z.infer<typeof createStaffInputSchema>;

// Editing a staff member takes exactly the same three fields as creating
// one — the password is never part of this form (there's a separate
// owner-initiated reset).
export const updateStaffInputSchema = createStaffInputSchema;

export type UpdateStaffInput = z.infer<typeof updateStaffInputSchema>;
