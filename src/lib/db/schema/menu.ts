import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./core";

export const menuCategories = pgTable("menu_categories", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  name: text("name").notNull(),
  displayOrder: integer("display_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("menu_categories_business_id_idx").on(table.businessId)]);

export const menuItems = pgTable("menu_items", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  categoryId: uuid("category_id").references(() => menuCategories.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  // Whole Rupiah, integer only.
  basePrice: integer("base_price").notNull(),
  taxBehavior: text("tax_behavior").notNull().default("exclusive"), // 'inclusive' | 'exclusive'
  active: boolean("active").notNull().default(true),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  // If false, this item is sold without recipe-based stock tracking
  // (the owner's explicit "no inventory tracking" override).
  tracksInventory: boolean("tracks_inventory").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("menu_items_business_id_idx").on(table.businessId)]);

export const menuItemVariants = pgTable("menu_item_variants", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  menuItemId: uuid("menu_item_id")
    .notNull()
    .references(() => menuItems.id, { onDelete: "cascade" }),
  name: text("name").notNull(), // e.g. Small / Regular / Large / Hot / Iced
  // Fixed selling price for this variant, whole Rupiah.
  price: integer("price").notNull(),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("menu_item_variants_menu_item_id_idx").on(table.menuItemId)]);

export const modifierGroups = pgTable("modifier_groups", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  businessId: uuid("business_id")
    .notNull()
    .references(() => businesses.id, { onDelete: "restrict" }),
  name: text("name").notNull(), // e.g. Sweetness, Milk choice, Extra shot
  required: boolean("required").notNull().default(false),
  minSelections: integer("min_selections").notNull().default(0),
  maxSelections: integer("max_selections").notNull().default(1),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("modifier_groups_business_id_idx").on(table.businessId)]);

export const modifierOptions = pgTable("modifier_options", {
  id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
  modifierGroupId: uuid("modifier_group_id")
    .notNull()
    .references(() => modifierGroups.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // May be negative (discount) or positive; whole Rupiah.
  priceAdjustment: integer("price_adjustment").notNull().default(0),
  active: boolean("active").notNull().default(true),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("modifier_options_group_id_idx").on(table.modifierGroupId)]);

/**
 * Which modifier groups apply to which menu items. Kept as its own join
 * table rather than a column on modifier_groups so a group (e.g.
 * "Sweetness") can be reused across many items.
 */
export const menuItemModifierGroups = pgTable(
  "menu_item_modifier_groups",
  {
    id: uuid("id").primaryKey().$defaultFn(() => randomUUID()),
    menuItemId: uuid("menu_item_id")
      .notNull()
      .references(() => menuItems.id, { onDelete: "cascade" }),
    modifierGroupId: uuid("modifier_group_id")
      .notNull()
      .references(() => modifierGroups.id, { onDelete: "cascade" }),
    displayOrder: integer("display_order").notNull().default(0),
  },
  (table) => [
    index("menu_item_modifier_groups_menu_item_id_idx").on(table.menuItemId),
    index("menu_item_modifier_groups_group_id_idx").on(table.modifierGroupId),
  ],
);
