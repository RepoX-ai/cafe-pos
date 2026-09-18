import { z } from "zod";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  displayOrder: z.coerce.number().int().default(0),
});
export type CategoryInput = z.infer<typeof categoryInputSchema>;

function isHttpUrl(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); }
  catch { return false; }
}

// Either an absolute URL (pasted by the cashier) or a site-relative path
// under /uploads/menu/ or a bundled Matsudon menu-board photo.
const menuImageUrlSchema = z
  .string()
  .trim()
  .max(2000)
  // Two upload shapes are accepted: the flat legacy path, and the
  // business-scoped one written since multi-tenancy. Both are UUID
  // filenames; the optional first segment is the owning business.
  .refine((v) => isHttpUrl(v) || /^\/(?:uploads|media)\/menu\/(?:[a-zA-Z0-9-]+\/)?[a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(v) || /^\/images\/menu\/matsudon\/[a-z0-9-]+\.webp$/.test(v), "Must be a valid URL")
  .optional()
  .or(z.literal(""));

export const menuItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: menuImageUrlSchema,
  basePrice: z.coerce.number().int().min(0, "Price cannot be negative"),
  taxBehavior: z.enum(["inclusive", "exclusive"]).default("exclusive"),
  tracksInventory: z.coerce.boolean().default(true),
  active: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const variantInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  price: z.coerce.number().int().min(0, "Price cannot be negative"),
  active: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const modifierGroupInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  required: z.coerce.boolean().default(false),
  minSelections: z.coerce.number().int().min(0).default(0),
  maxSelections: z.coerce.number().int().min(1).default(1),
});
export type ModifierGroupInput = z.infer<typeof modifierGroupInputSchema>;

export const modifierOptionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  priceAdjustment: z.coerce.number().int().default(0),
  active: z.coerce.boolean().default(true),
  displayOrder: z.coerce.number().int().default(0),
});
export type ModifierOptionInput = z.infer<typeof modifierOptionInputSchema>;

