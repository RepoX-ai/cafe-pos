import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { ingredients, menuCategories, menuItems, menuItemVariants, recipeLines, recipes } from "@/lib/db/schema";
import { csvHeader, csvRow, type CsvColumn } from "@/lib/csv/csv";
import { parseCsvRecords } from "@/lib/csv/csv-parse";
import { BOUNDS } from "@/lib/validation/bounds";
import { MENU_CSV_COLUMNS, menuCsvRowSchema, normalizeMenuCsvRecord } from "@/lib/validation/menu-bulk";
import type { RecipeLineInput } from "@/lib/validation/recipe";
import { recordAuditLog } from "./audit";
import { ServiceError } from "./errors";
import type { ActorContext } from "./ingredient-service";
import { runIdempotent } from "./request-idempotency";
import { saveRecipe } from "./recipe-service";

/** Well past any real café's catalog; keeps a malformed/huge upload from tying up the transaction. */
const MAX_IMPORT_ROWS = 5000;

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

interface ExportRow extends Record<string, unknown> {
  item_id: string;
  item_name: string;
  category_name: string;
  item_active: string;
  tracks_inventory: string;
  variant_id: string;
  variant_name: string;
  variant_price: number;
  variant_active: string;
  ingredient_name: string;
  quantity_base_units: string;
  waste_percentage: string;
  recipe_notes: string;
}

const EXPORT_COLUMNS: CsvColumn<ExportRow>[] = MENU_CSV_COLUMNS.map((key) => ({ key, label: key }));

/**
 * Builds the same flat, one-row-per-recipe-line CSV the import side reads —
 * editing this file and re-uploading it is the bulk-update workflow. A
 * variant with no recipe yet still gets one row, ingredient columns blank.
 */
export async function buildMenuExportCsv(db: Database, businessId: string): Promise<string> {
  const items = await db
    .select({
      id: menuItems.id,
      name: menuItems.name,
      categoryName: menuCategories.name,
      active: menuItems.active,
      tracksInventory: menuItems.tracksInventory,
      displayOrder: menuItems.displayOrder,
    })
    .from(menuItems)
    .leftJoin(menuCategories, and(eq(menuItems.categoryId, menuCategories.id), eq(menuCategories.businessId, businessId)))
    .where(eq(menuItems.businessId, businessId))
    .orderBy(asc(menuItems.displayOrder), asc(menuItems.name));

  const variants = items.length
    ? await db
        .select({ id: menuItemVariants.id, menuItemId: menuItemVariants.menuItemId, name: menuItemVariants.name, price: menuItemVariants.price, active: menuItemVariants.active, displayOrder: menuItemVariants.displayOrder })
        .from(menuItemVariants)
        .where(inArray(menuItemVariants.menuItemId, items.map((i) => i.id)))
        .orderBy(asc(menuItemVariants.displayOrder), asc(menuItemVariants.name))
    : [];

  const activeRecipes = variants.length
    ? await db
        .select({ id: recipes.id, variantId: recipes.menuItemVariantId })
        .from(recipes)
        .where(and(eq(recipes.businessId, businessId), eq(recipes.active, true), inArray(recipes.menuItemVariantId, variants.map((v) => v.id))))
    : [];
  const variantIdByRecipeId = new Map(activeRecipes.map((r) => [r.id, r.variantId]));

  const lines = activeRecipes.length
    ? await db
        .select({
          recipeId: recipeLines.recipeId,
          ingredientName: ingredients.name,
          quantityBaseUnits: recipeLines.quantityBaseUnits,
          wastePercentage: recipeLines.wastePercentage,
          notes: recipeLines.notes,
        })
        .from(recipeLines)
        .innerJoin(ingredients, and(eq(recipeLines.ingredientId, ingredients.id), eq(ingredients.businessId, businessId)))
        .where(inArray(recipeLines.recipeId, activeRecipes.map((r) => r.id)))
    : [];

  const linesByVariant = new Map<string, typeof lines>();
  for (const line of lines) {
    const variantId = variantIdByRecipeId.get(line.recipeId);
    if (!variantId) continue;
    const list = linesByVariant.get(variantId) ?? [];
    list.push(line);
    linesByVariant.set(variantId, list);
  }

  const variantsByItem = new Map<string, typeof variants>();
  for (const variant of variants) {
    const list = variantsByItem.get(variant.menuItemId) ?? [];
    list.push(variant);
    variantsByItem.set(variant.menuItemId, list);
  }

  const rows: ExportRow[] = [];
  for (const item of items) {
    const itemVariants = variantsByItem.get(item.id) ?? [];
    if (itemVariants.length === 0) {
      // A menu item can never actually end up with zero variants in this
      // app, but nothing stops the export from being honest if it ever did.
      rows.push({
        item_id: item.id,
        item_name: item.name,
        category_name: item.categoryName ?? "",
        item_active: String(item.active),
        tracks_inventory: String(item.tracksInventory),
        variant_id: "",
        variant_name: "",
        variant_price: 0,
        variant_active: "",
        ingredient_name: "",
        quantity_base_units: "",
        waste_percentage: "",
        recipe_notes: "",
      });
      continue;
    }
    for (const variant of itemVariants) {
      const variantLines = linesByVariant.get(variant.id) ?? [];
      if (variantLines.length === 0) {
        rows.push({
          item_id: item.id,
          item_name: item.name,
          category_name: item.categoryName ?? "",
          item_active: String(item.active),
          tracks_inventory: String(item.tracksInventory),
          variant_id: variant.id,
          variant_name: variant.name,
          variant_price: variant.price,
          variant_active: String(variant.active),
          ingredient_name: "",
          quantity_base_units: "",
          waste_percentage: "",
          recipe_notes: "",
        });
        continue;
      }
      for (const line of variantLines) {
        rows.push({
          item_id: item.id,
          item_name: item.name,
          category_name: item.categoryName ?? "",
          item_active: String(item.active),
          tracks_inventory: String(item.tracksInventory),
          variant_id: variant.id,
          variant_name: variant.name,
          variant_price: variant.price,
          variant_active: String(variant.active),
          ingredient_name: line.ingredientName,
          quantity_base_units: line.quantityBaseUnits,
          waste_percentage: line.wastePercentage ?? "0",
          recipe_notes: line.notes ?? "",
        });
      }
    }
  }

  const out = [csvHeader(EXPORT_COLUMNS)];
  for (const row of rows) out.push(csvRow(row, EXPORT_COLUMNS));
  return out.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

interface VariantGroup {
  variantId: string | null;
  name: string;
  price: number;
  active: boolean;
  hasRecipeRow: boolean;
  recipeLines: { ingredientName: string; quantityBaseUnits: number; wastePercentage: number; notes: string }[];
  firstRowNumber: number;
}

interface ItemGroup {
  itemId: string | null;
  name: string;
  categoryName: string;
  active: boolean;
  tracksInventory: boolean;
  variants: VariantGroup[];
  firstRowNumber: number;
}

export interface ParsedMenuImport {
  itemGroups: ItemGroup[];
  hasRecipeRows: boolean;
  rowCount: number;
}

export type ParseMenuImportResult =
  | { ok: true; data: ParsedMenuImport }
  | { ok: false; error: string; rowErrors?: { row: number; message: string }[] };

/**
 * Parses and groups the uploaded CSV — pure, no DB access, so the caller can
 * decide what permission to require (recipes:write only if the file actually
 * carries recipe lines) before opening a transaction.
 */
export function parseMenuImportCsv(csvText: string): ParseMenuImportResult {
  const records = parseCsvRecords(csvText);
  if (records.length === 0) return { ok: false, error: "The file has no data rows." };
  if (records.length > MAX_IMPORT_ROWS) return { ok: false, error: `Too many rows (max ${MAX_IMPORT_ROWS}).` };

  const rowErrors: { row: number; message: string }[] = [];
  const itemGroups: ItemGroup[] = [];
  const itemIndexByKey = new Map<string, number>();
  let hasRecipeRows = false;

  records.forEach((record, index) => {
    const rowNumber = index + 2; // header is row 1
    const parsed = menuCsvRowSchema.safeParse(normalizeMenuCsvRecord(record));
    if (!parsed.success) {
      rowErrors.push({ row: rowNumber, message: parsed.error.issues[0]?.message ?? "Invalid row" });
      return;
    }
    const row = parsed.data;
    if (rowErrors.length > 0) return; // stop grouping once any row has failed; only the errors matter now

    const itemKey = row.itemId || `name:${row.itemName.toLowerCase()}`;
    let itemIndex = itemIndexByKey.get(itemKey);
    if (itemIndex === undefined) {
      itemIndex = itemGroups.length;
      itemIndexByKey.set(itemKey, itemIndex);
      itemGroups.push({
        itemId: row.itemId || null,
        name: row.itemName,
        categoryName: row.categoryName ?? "",
        active: row.itemActive,
        tracksInventory: row.tracksInventory,
        variants: [],
        firstRowNumber: rowNumber,
      });
    }
    const item = itemGroups[itemIndex];

    const variantKey = row.variantId || `name:${row.variantName.toLowerCase()}`;
    let variant = item.variants.find((v) => (v.variantId || `name:${v.name.toLowerCase()}`) === variantKey);
    if (!variant) {
      variant = {
        variantId: row.variantId || null,
        name: row.variantName,
        price: row.variantPrice,
        active: row.variantActive,
        hasRecipeRow: false,
        recipeLines: [],
        firstRowNumber: rowNumber,
      };
      item.variants.push(variant);
    }

    if (row.ingredientName) {
      hasRecipeRows = true;
      variant.hasRecipeRow = true;
      variant.recipeLines.push({
        ingredientName: row.ingredientName,
        quantityBaseUnits: row.quantityBaseUnits!,
        wastePercentage: row.wastePercentage,
        notes: row.recipeNotes ?? "",
      });
    }
  });

  if (rowErrors.length > 0) return { ok: false, error: "Some rows failed validation.", rowErrors };

  for (const item of itemGroups) {
    if (item.variants.length > BOUNDS.recipeLines) {
      // Reuses the recipe-lines bound as a sane per-item variant cap; there's
      // no dedicated one and this is generous for a real menu item.
      return { ok: false, error: `"${item.name}" has too many variant rows.` };
    }
    for (const variant of item.variants) {
      if (variant.recipeLines.length > BOUNDS.recipeLines) {
        return { ok: false, error: `"${item.name}" / "${variant.name}" has too many ingredient rows (max ${BOUNDS.recipeLines}).` };
      }
      // A blank item_id means "create this item", so it can't own a variant
      // that already has an id — that variant would belong to some other,
      // existing item. Catch this here with a row number attached rather
      // than letting it surface later as an opaque "variant not found".
      if (!item.itemId && variant.variantId) {
        return { ok: false, error: `Row ${variant.firstRowNumber}: variant_id is set but item_id is blank — either fill in the item's id too, or clear the variant_id to add it as new.` };
      }
    }
  }

  return { ok: true, data: { itemGroups, hasRecipeRows, rowCount: records.length } };
}

export interface MenuImportResult {
  itemsCreated: number;
  itemsUpdated: number;
  variantsCreated: number;
  variantsUpdated: number;
  recipesReplaced: number;
}

/**
 * Applies an already-parsed import in one transaction — all-or-nothing, like
 * every other stock-affecting flow in this app (PRD rule: one action, one
 * transaction). A retried upload with the same idempotency key replays
 * instead of double-importing.
 */
export async function applyMenuImport(
  db: Database,
  actor: ActorContext,
  data: ParsedMenuImport,
  idempotencyKey: string | undefined,
): Promise<{ result: MenuImportResult; replayed: boolean }> {
  return db.transaction(async (tx) => {
    return runIdempotent(
      tx,
      { businessId: actor.businessId, operation: "menu.bulk_import", key: idempotencyKey, payload: data.itemGroups },
      async () => {
        const result: MenuImportResult = { itemsCreated: 0, itemsUpdated: 0, variantsCreated: 0, variantsUpdated: 0, recipesReplaced: 0 };

        const categories = await tx
          .select({ id: menuCategories.id, name: menuCategories.name })
          .from(menuCategories)
          .where(eq(menuCategories.businessId, actor.businessId));
        const categoryIdByName = new Map(categories.map((c) => [c.name.toLowerCase(), c.id]));

        const ingredientRows = await tx
          .select({ id: ingredients.id, name: ingredients.name })
          .from(ingredients)
          .where(eq(ingredients.businessId, actor.businessId));
        const ingredientIdByName = new Map(ingredientRows.map((i) => [i.name.toLowerCase(), i.id]));

        for (const item of data.itemGroups) {
          let categoryId: string | null = null;
          if (item.categoryName) {
            const found = categoryIdByName.get(item.categoryName.toLowerCase());
            if (!found) throw new ServiceError(`Row ${item.firstRowNumber}: category "${item.categoryName}" not found.`);
            categoryId = found;
          }

          const firstVariantPrice = item.variants[0]?.price ?? 0;
          let itemId: string;
          if (item.itemId) {
            const [existing] = await tx
              .select({ id: menuItems.id })
              .from(menuItems)
              .where(and(eq(menuItems.id, item.itemId), eq(menuItems.businessId, actor.businessId)))
              .limit(1);
            if (!existing) throw new ServiceError(`Row ${item.firstRowNumber}: menu item not found.`);
            itemId = existing.id;
            await tx
              .update(menuItems)
              .set({
                categoryId,
                name: item.name,
                active: item.active,
                tracksInventory: item.tracksInventory,
                updatedBy: actor.userId,
                updatedAt: new Date(),
              })
              .where(eq(menuItems.id, itemId));
            result.itemsUpdated += 1;
            await recordAuditLog(tx, {
              businessId: actor.businessId,
              actorUserId: actor.userId,
              action: "menu_item.bulk_updated",
              entityType: "menu_item",
              entityId: itemId,
            });
          } else {
            const [created] = await tx
              .insert(menuItems)
              .values({
                businessId: actor.businessId,
                categoryId,
                name: item.name,
                basePrice: firstVariantPrice,
                tracksInventory: item.tracksInventory,
                active: item.active,
                createdBy: actor.userId,
                updatedBy: actor.userId,
              })
              .returning();
            itemId = created.id;
            result.itemsCreated += 1;
            await recordAuditLog(tx, {
              businessId: actor.businessId,
              actorUserId: actor.userId,
              action: "menu_item.bulk_created",
              entityType: "menu_item",
              entityId: itemId,
              after: created,
            });
          }

          for (const variant of item.variants) {
            let variantId: string;
            if (variant.variantId) {
              const [existing] = await tx
                .select({ id: menuItemVariants.id })
                .from(menuItemVariants)
                .innerJoin(menuItems, eq(menuItemVariants.menuItemId, menuItems.id))
                .where(and(eq(menuItemVariants.id, variant.variantId), eq(menuItems.businessId, actor.businessId)))
                .limit(1);
              if (!existing) throw new ServiceError(`Row ${variant.firstRowNumber}: variant not found.`);
              variantId = existing.id;
              await tx
                .update(menuItemVariants)
                .set({ name: variant.name, price: variant.price, active: variant.active, updatedAt: new Date() })
                .where(eq(menuItemVariants.id, variantId));
              result.variantsUpdated += 1;
            } else {
              const [created] = await tx
                .insert(menuItemVariants)
                .values({ menuItemId: itemId, name: variant.name, price: variant.price, active: variant.active })
                .returning();
              variantId = created.id;
              result.variantsCreated += 1;
            }

            if (variant.hasRecipeRow) {
              const seen = new Set<string>();
              const lines: RecipeLineInput[] = [];
              for (const line of variant.recipeLines) {
                const ingredientId = ingredientIdByName.get(line.ingredientName.toLowerCase());
                if (!ingredientId) throw new ServiceError(`Row ${variant.firstRowNumber}: ingredient "${line.ingredientName}" not found.`);
                if (seen.has(ingredientId)) throw new ServiceError(`Row ${variant.firstRowNumber}: ingredient "${line.ingredientName}" repeated for the same variant.`);
                seen.add(ingredientId);
                lines.push({ ingredientId, quantityBaseUnits: line.quantityBaseUnits, wastePercentage: line.wastePercentage, notes: line.notes || undefined });
              }
              await saveRecipe(tx, actor, { menuItemVariantId: variantId, lines });
              result.recipesReplaced += 1;
            }
          }
        }

        await recordAuditLog(tx, {
          businessId: actor.businessId,
          actorUserId: actor.userId,
          action: "menu.bulk_imported",
          entityType: "menu_bulk_import",
          metadata: result,
        });

        return result;
      },
      async () => ({ itemsCreated: 0, itemsUpdated: 0, variantsCreated: 0, variantsUpdated: 0, recipesReplaced: 0 }),
    );
  });
}
