import { randomUUID } from "node:crypto";
import {
  boolean,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
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
  menuItemVariantId: uuid("menu_item_variant_id")
    .notNull()
    .references(() => menuItemVariants.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
});

export const recipeLines = pgTable("recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
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
});

export const modifierRecipeLines = pgTable("modifier_recipe_lines", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  modifierOptionId: uuid("modifier_option_id")
    .notNull()
    .references(() => modifierOptions.id, { onDelete: "cascade" }),
  ingredientId: uuid("ingredient_id")
    .notNull()
    .references(() => ingredients.id, { onDelete: "cascade" }),
  quantityBaseUnits: numeric("quantity_base_units", { precision: 16, scale: 4 }).notNull(),
  wastePercentage: numeric("waste_percentage", { precision: 5, scale: 2 }).default("0"),
});
