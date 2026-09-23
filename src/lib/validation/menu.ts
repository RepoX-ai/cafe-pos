import { z } from "zod";
import { BOUNDS, displayOrderSchema } from "./bounds";

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  displayOrder: displayOrderSchema,
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
  .refine((v) => isHttpUrl(v) || /^\/(?:uploads|media)\/(?:menu|brand)\/(?:[a-zA-Z0-9-]+\/)?[a-zA-Z0-9-]+\.(?:jpg|jpeg|png|webp)$/.test(v) || /^\/images\/menu\/matsudon\/[a-z0-9-]+\.webp$/.test(v), "Must be a valid URL")
  .optional()
  .or(z.literal(""));

export const menuItemInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  imageUrl: menuImageUrlSchema,
  basePrice: z.coerce.number().int().min(0, "Price cannot be negative").max(BOUNDS.maxInt, "Price is too large"),
  taxBehavior: z.enum(["inclusive", "exclusive"]).default("exclusive"),
  tracksInventory: z.coerce.boolean().default(true),
  active: z.coerce.boolean().default(true),
  displayOrder: displayOrderSchema,
});
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;

export const variantInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  price: z.coerce.number().int().min(0, "Price cannot be negative").max(BOUNDS.maxInt, "Price is too large"),
  active: z.coerce.boolean().default(true),
  displayOrder: displayOrderSchema,
});
export type VariantInput = z.infer<typeof variantInputSchema>;

export const modifierGroupInputSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(200),
    required: z.coerce.boolean().default(false),
    minSelections: z.coerce.number().int().min(0).max(BOUNDS.maxSelections).default(0),
    maxSelections: z.coerce.number().int().min(1).max(BOUNDS.maxSelections).default(1),
  })
  .refine((g) => g.minSelections <= g.maxSelections, { path: ["minSelections"], message: "Minimum can't be more than maximum" });
export type ModifierGroupInput = z.infer<typeof modifierGroupInputSchema>;

export const modifierOptionInputSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  priceAdjustment: z.coerce.number().int().min(-BOUNDS.maxInt).max(BOUNDS.maxInt).default(0),
  active: z.coerce.boolean().default(true),
  displayOrder: displayOrderSchema,
});

/** The full set of modifier groups for one item (replaces the previous set). */
export const itemModifierGroupsSchema = z.object({
  menuItemId: z.string().uuid(),
  groupIds: z.array(z.string().uuid()).max(BOUNDS.modifierGroupsPerItem, `An item can have at most ${BOUNDS.modifierGroupsPerItem} modifier groups`),
});

export const supplierInputSchema = z.object({
  name: z.string().trim().min(1, "Supplier name is required").max(200),
  contactName: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().max(254).optional(),
  address: z.string().trim().max(1000).optional(),
});
export type ModifierOptionInput = z.infer<typeof modifierOptionInputSchema>;

