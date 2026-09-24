import { z } from "zod";
import { BOUNDS } from "./bounds";

/**
 * Column order for the menu bulk CSV, both directions. One row per recipe
 * line; item/variant fields repeat across the rows that share them (the
 * flat shape a spreadsheet round-trips cleanly). A variant with no recipe
 * yet still gets one row, with the ingredient columns left blank.
 */
export const MENU_CSV_COLUMNS = [
  "item_id",
  "item_name",
  "category_name",
  "item_active",
  "tracks_inventory",
  "variant_id",
  "variant_name",
  "variant_price",
  "variant_active",
  "ingredient_name",
  "quantity_base_units",
  "waste_percentage",
  "recipe_notes",
] as const;

function parseBoolCell(value: string, defaultValue: boolean): boolean {
  const v = value.trim().toLowerCase();
  if (v === "") return defaultValue;
  return v === "true" || v === "1" || v === "yes";
}

const uuidOrBlank = z.string().uuid().optional().or(z.literal(""));

export const menuCsvRowSchema = z
  .object({
    itemId: uuidOrBlank,
    itemName: z.string().trim().min(1, "Item name is required").max(200),
    categoryName: z.string().trim().max(200).optional().or(z.literal("")),
    itemActive: z.boolean(),
    tracksInventory: z.boolean(),
    variantId: uuidOrBlank,
    variantName: z.string().trim().min(1, "Variant name is required").max(100),
    variantPrice: z.coerce.number().int().min(0, "Price cannot be negative").max(BOUNDS.maxInt, "Price is too large"),
    variantActive: z.boolean(),
    ingredientName: z.string().trim().max(200).optional().or(z.literal("")),
    quantityBaseUnits: z.coerce.number().positive("Quantity must be greater than zero").max(BOUNDS.maxQuantity).optional(),
    wastePercentage: z.coerce.number().min(0).max(100).default(0),
    recipeNotes: z.string().trim().max(500).optional().or(z.literal("")),
  })
  .refine((row) => !row.ingredientName || row.quantityBaseUnits !== undefined, {
    message: "Quantity is required when an ingredient is set",
    path: ["quantityBaseUnits"],
  });

export type MenuCsvRow = z.infer<typeof menuCsvRowSchema>;

/** Raw CSV record (string cells, header-keyed) -> the shape the schema above expects. */
export function normalizeMenuCsvRecord(record: Record<string, string>) {
  const quantity = (record.quantity_base_units ?? "").trim();
  return {
    itemId: record.item_id ?? "",
    itemName: record.item_name ?? "",
    categoryName: record.category_name ?? "",
    itemActive: parseBoolCell(record.item_active ?? "", true),
    tracksInventory: parseBoolCell(record.tracks_inventory ?? "", true),
    variantId: record.variant_id ?? "",
    variantName: record.variant_name ?? "",
    variantPrice: record.variant_price ?? "",
    variantActive: parseBoolCell(record.variant_active ?? "", true),
    ingredientName: record.ingredient_name ?? "",
    quantityBaseUnits: quantity === "" ? undefined : quantity,
    wastePercentage: record.waste_percentage ?? "",
    recipeNotes: record.recipe_notes ?? "",
  };
}
