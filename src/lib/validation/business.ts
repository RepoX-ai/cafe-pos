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

/**
 * A business's visual identity. The logo arrives as a file on the same
 * form, so it is not part of this schema — only the colour and the
 * pre-rasterised receipt copy the browser produced alongside it.
 */
export const brandingInputSchema = z.object({
  brandColor: z
    .string()
    .trim()
    .regex(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Use a hex colour like #A5502B")
    .optional()
    .or(z.literal("")),
  /** Packed 1-bit receipt raster from the browser; see lib/branding/raster. */
  logoRasterBase64: z.string().max(200_000).optional().or(z.literal("")),
  logoRasterWidth: z.coerce.number().int().min(8).max(384).optional(),
  logoRasterHeight: z.coerce.number().int().min(1).max(240).optional(),
  removeLogo: z.coerce.boolean().default(false),
});

export type BrandingInput = z.infer<typeof brandingInputSchema>;
