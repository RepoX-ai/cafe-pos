import { z } from "zod";

/**
 * Creating a whole new tenant, not editing the current one — see
 * `src/lib/validation/settings.ts` for the latter. Only the two fields a
 * business cannot sensibly start without; everything else has a default
 * and is edited afterwards in Settings.
 */
export const createBusinessInputSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(200),
  orderNumberPrefix: z
    .string()
    .trim()
    .min(1, "Order prefix is required")
    .max(8, "Keep the prefix to 8 characters or fewer")
    .regex(/^[A-Za-z0-9-]+$/, "Letters, numbers and dashes only")
    .transform((v) => v.toUpperCase()),
});

export type CreateBusinessInput = z.infer<typeof createBusinessInputSchema>;
