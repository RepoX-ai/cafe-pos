import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
  // At most one live recipe per variant — the lookup checkout, POS stock
  // badges and the recipe editor all make. saveRecipe also serializes on
  // the variant row, so this is the backstop, not the mechanism.
  uniqueIndex("recipes_one_active_per_variant_idx")
    .on(table.menuItemVariantId)
    .where(sql`${table.active}`),
  // Version numbers never repeat per variant; also serves the cascade when
  // a variant is deleted (inactive versions included).
  uniqueIndex("recipes_variant_version_idx").on(table.menuItemVariantId, table.version),
  index("recipes_business_id_idx").on(table.businessId),
  unique("recipes_business_id_id_key").on(table.businessId, table.id),
]);

export const recipeLines = pgTable("recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  // Both references are composite with business_id, so a line can only
  // join a recipe and an ingredient of its own business.
  recipeId: uuid("recipe_id").notNull(),
  // Deleting an ingredient drops it out of every recipe that used it (the
  // owner is warned how many first). Unlike the history tables there is
  // nothing to preserve here: a recipe is a forward-looking instruction,
  // and what past orders actually consumed lives in
  // `order_ingredient_consumption`.
  ingredientId: uuid("ingredient_id").notNull(),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).default("0"),
  notes: text("notes"),
}, (table) => [
  index("recipe_lines_recipe_id_idx").on(table.recipeId),
  // The cascade when an ingredient is deleted, and recipe-usage counts.
  index("recipe_lines_ingredient_id_idx").on(table.ingredientId),
  index("recipe_lines_business_id_idx").on(table.businessId),
  foreignKey({
    name: "recipe_lines_recipe_same_business_fk",
    columns: [table.businessId, table.recipeId],
    foreignColumns: [recipes.businessId, recipes.id],
  }).onDelete("cascade"),
  foreignKey({
    name: "recipe_lines_ingredient_same_business_fk",
    columns: [table.businessId, table.ingredientId],
    foreignColumns: [ingredients.businessId, ingredients.id],
  }).onDelete("cascade"),
]);

export const modifierRecipeLines = pgTable("modifier_recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  modifierOptionId: uuid("modifier_option_id")
    .notNull()
    .references(() => modifierOptions.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id").notNull(),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).default("0"),
}, (table) => [
  foreignKey({
    name: "modifier_recipe_lines_ingredient_same_business_fk",
    columns: [table.businessId, table.ingredientId],
    foreignColumns: [ingredients.businessId, ingredients.id],
  }).onDelete("cascade"),
  index("modifier_recipe_lines_option_id_idx").on(table.modifierOptionId),
  index("modifier_recipe_lines_ingredient_id_idx").on(table.ingredientId),
  index("modifier_recipe_lines_business_id_idx").on(table.businessId),
]);
