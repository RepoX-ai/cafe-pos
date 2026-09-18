import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./core";
import { ingredients } from "./ingredients";
import { menuItemVariants, modifierOptions } from "./menu";
import { users } from "./auth";

/**
 * A recipe belongs to exactly one menu item variant. `version` +
 * `active` let us keep prior recipe versions around (never edited in
 * place) so historical orders can point at the exact recipe that was
 * live when they were placed, per "recipe edits affect future orders
 * only."
 */
export const recipes = pgTable("recipes", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  // Denormalised from the owning menu item. Tenancy was previously only
  // reachable by joining variant -> item, which every query had to
  // remember and which row-level security cannot express.
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  menuItemVariantId: uuid("menu_item_variant_id")
    .notNull()
    .references(() => menuItemVariants.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  // "Latest active recipe for these variants" — checkout, POS stock badges, recipe editor.
  index("recipes_active_variant_version_idx")
    .on(table.menuItemVariantId, table.version)
    .where(sql`${table.active}`),
  // Inactive versions too: the cascade when a variant is deleted.
  index("recipes_variant_id_idx").on(table.menuItemVariantId),
  index("recipes_business_id_idx").on(table.businessId),
]);

export const recipeLines = pgTable("recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  recipeId: uuid("recipe_id")
    .notNull()
    .references(() => recipes.id, { onDelete: "cascade" }),
  // Deleting an ingredient drops it out of every recipe that used it (the
  // owner is warned how many first). Unlike the history tables there is
  // nothing to preserve here: a recipe is a forward-looking instruction,
  // and what past orders actually consumed lives in
  // `order_ingredient_consumption`.
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).default("0"),
  notes: text("notes"),
}, (table) => [
  index("recipe_lines_recipe_id_idx").on(table.recipeId),
  // The cascade when an ingredient is deleted, and recipe-usage counts.
  index("recipe_lines_ingredient_id_idx").on(table.ingredientId),
  index("recipe_lines_business_id_idx").on(table.businessId),
]);

export const modifierRecipeLines = pgTable("modifier_recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  modifierOptionId: uuid("modifier_option_id")
    .notNull()
    .references(() => modifierOptions.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).default("0"),
}, (table) => [
  index("modifier_recipe_lines_option_id_idx").on(table.modifierOptionId),
  index("modifier_recipe_lines_ingredient_id_idx").on(table.ingredientId),
  index("modifier_recipe_lines_business_id_idx").on(table.businessId),
]);
