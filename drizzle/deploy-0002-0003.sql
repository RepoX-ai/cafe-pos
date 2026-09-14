-- =====================================================================
-- CaféOps — schema + backfill for menu/ingredient delete
-- Run ONCE against the production database, BEFORE (or with) the deploy.
-- Safe to re-run: every step is guarded.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. Migration 0002 — order lines remember their category
-- ---------------------------------------------------------------------
ALTER TABLE "order_lines" ADD COLUMN IF NOT EXISTS "category_name_snapshot" text;

-- ---------------------------------------------------------------------
-- 2. Migration 0003 — history tables remember their ingredient,
--    and stop blocking the ingredient's deletion
-- ---------------------------------------------------------------------
ALTER TABLE "purchase_lines"                ADD COLUMN IF NOT EXISTS "ingredient_name_snapshot" text;
ALTER TABLE "purchase_lines"                ADD COLUMN IF NOT EXISTS "ingredient_base_unit_snapshot" "base_unit";
ALTER TABLE "inventory_movements"           ADD COLUMN IF NOT EXISTS "ingredient_name_snapshot" text;
ALTER TABLE "inventory_movements"           ADD COLUMN IF NOT EXISTS "ingredient_base_unit_snapshot" "base_unit";
ALTER TABLE "stock_count_lines"             ADD COLUMN IF NOT EXISTS "ingredient_name_snapshot" text;
ALTER TABLE "stock_count_lines"             ADD COLUMN IF NOT EXISTS "ingredient_base_unit_snapshot" "base_unit";
ALTER TABLE "waste_records"                 ADD COLUMN IF NOT EXISTS "ingredient_name_snapshot" text;
ALTER TABLE "waste_records"                 ADD COLUMN IF NOT EXISTS "ingredient_base_unit_snapshot" "base_unit";
ALTER TABLE "order_ingredient_consumption"  ADD COLUMN IF NOT EXISTS "ingredient_name_snapshot" text;
ALTER TABLE "order_ingredient_consumption"  ADD COLUMN IF NOT EXISTS "ingredient_base_unit_snapshot" "base_unit";

ALTER TABLE "purchase_lines"               ALTER COLUMN "ingredient_id" DROP NOT NULL;
ALTER TABLE "inventory_movements"          ALTER COLUMN "ingredient_id" DROP NOT NULL;
ALTER TABLE "stock_count_lines"            ALTER COLUMN "ingredient_id" DROP NOT NULL;
ALTER TABLE "waste_records"                ALTER COLUMN "ingredient_id" DROP NOT NULL;
ALTER TABLE "order_ingredient_consumption" ALTER COLUMN "ingredient_id" DROP NOT NULL;

-- Recipe lines follow the ingredient into the bin (cascade); the five
-- history tables keep their row and just lose the link (set null).
ALTER TABLE "modifier_recipe_lines"        DROP CONSTRAINT IF EXISTS "modifier_recipe_lines_ingredient_id_ingredients_id_fk";
ALTER TABLE "recipe_lines"                 DROP CONSTRAINT IF EXISTS "recipe_lines_ingredient_id_ingredients_id_fk";
ALTER TABLE "purchase_lines"               DROP CONSTRAINT IF EXISTS "purchase_lines_ingredient_id_ingredients_id_fk";
ALTER TABLE "inventory_movements"          DROP CONSTRAINT IF EXISTS "inventory_movements_ingredient_id_ingredients_id_fk";
ALTER TABLE "stock_count_lines"            DROP CONSTRAINT IF EXISTS "stock_count_lines_ingredient_id_ingredients_id_fk";
ALTER TABLE "waste_records"                DROP CONSTRAINT IF EXISTS "waste_records_ingredient_id_ingredients_id_fk";
ALTER TABLE "order_ingredient_consumption" DROP CONSTRAINT IF EXISTS "order_ingredient_consumption_ingredient_id_ingredients_id_fk";

ALTER TABLE "modifier_recipe_lines"        ADD CONSTRAINT "modifier_recipe_lines_ingredient_id_ingredients_id_fk"        FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade  ON UPDATE no action;
ALTER TABLE "recipe_lines"                 ADD CONSTRAINT "recipe_lines_ingredient_id_ingredients_id_fk"                 FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE cascade  ON UPDATE no action;
ALTER TABLE "purchase_lines"               ADD CONSTRAINT "purchase_lines_ingredient_id_ingredients_id_fk"               FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "inventory_movements"          ADD CONSTRAINT "inventory_movements_ingredient_id_ingredients_id_fk"          FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "stock_count_lines"            ADD CONSTRAINT "stock_count_lines_ingredient_id_ingredients_id_fk"            FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "waste_records"                ADD CONSTRAINT "waste_records_ingredient_id_ingredients_id_fk"                FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "order_ingredient_consumption" ADD CONSTRAINT "order_ingredient_consumption_ingredient_id_ingredients_id_fk" FOREIGN KEY ("ingredient_id") REFERENCES "public"."ingredients"("id") ON DELETE set null ON UPDATE no action;

-- ---------------------------------------------------------------------
-- 3. Backfill — give existing history its own record of what it was
--    about, while the menu items and ingredients still exist.
--    THIS IS THE PART THAT MUST RUN BEFORE ANYONE DELETES ANYTHING.
-- ---------------------------------------------------------------------
UPDATE order_lines ol
SET category_name_snapshot = mc.name
FROM menu_items mi
JOIN menu_categories mc ON mc.id = mi.category_id
WHERE ol.menu_item_id = mi.id
  AND ol.category_name_snapshot IS NULL;

UPDATE inventory_movements t
SET ingredient_name_snapshot = i.name, ingredient_base_unit_snapshot = i.base_unit
FROM ingredients i
WHERE t.ingredient_id = i.id AND t.ingredient_name_snapshot IS NULL;

UPDATE order_ingredient_consumption t
SET ingredient_name_snapshot = i.name, ingredient_base_unit_snapshot = i.base_unit
FROM ingredients i
WHERE t.ingredient_id = i.id AND t.ingredient_name_snapshot IS NULL;

UPDATE purchase_lines t
SET ingredient_name_snapshot = i.name, ingredient_base_unit_snapshot = i.base_unit
FROM ingredients i
WHERE t.ingredient_id = i.id AND t.ingredient_name_snapshot IS NULL;

UPDATE waste_records t
SET ingredient_name_snapshot = i.name, ingredient_base_unit_snapshot = i.base_unit
FROM ingredients i
WHERE t.ingredient_id = i.id AND t.ingredient_name_snapshot IS NULL;

UPDATE stock_count_lines t
SET ingredient_name_snapshot = i.name, ingredient_base_unit_snapshot = i.base_unit
FROM ingredients i
WHERE t.ingredient_id = i.id AND t.ingredient_name_snapshot IS NULL;

-- ---------------------------------------------------------------------
-- 4. Tell Drizzle these two migrations are already applied, so a later
--    `npm run db:migrate` skips them instead of failing on re-run.
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS "drizzle";
CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT '0ba87391ab91a63efa50c919ac4730f3f73cc2aacc0951b2253b566285a9bf98', 1789301661342
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations"
  WHERE hash = '0ba87391ab91a63efa50c919ac4730f3f73cc2aacc0951b2253b566285a9bf98'
);

INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at)
SELECT 'a52e2ec4074646be80e8721d8c7bd1290965f50e4d9e22917f49f1bbbdc0b672', 1789302323299
WHERE NOT EXISTS (
  SELECT 1 FROM "drizzle"."__drizzle_migrations"
  WHERE hash = 'a52e2ec4074646be80e8721d8c7bd1290965f50e4d9e22917f49f1bbbdc0b672'
);

COMMIT;

-- ---------------------------------------------------------------------
-- 5. Verification — every number in the "missing" column must be 0.
-- ---------------------------------------------------------------------
SELECT 'order_lines.category'            AS what,
       count(*) FILTER (WHERE ol.category_name_snapshot IS NULL AND ol.menu_item_id IS NOT NULL) AS missing
FROM order_lines ol
UNION ALL SELECT 'inventory_movements',          count(*) FILTER (WHERE ingredient_name_snapshot IS NULL AND ingredient_id IS NOT NULL) FROM inventory_movements
UNION ALL SELECT 'order_ingredient_consumption', count(*) FILTER (WHERE ingredient_name_snapshot IS NULL AND ingredient_id IS NOT NULL) FROM order_ingredient_consumption
UNION ALL SELECT 'purchase_lines',               count(*) FILTER (WHERE ingredient_name_snapshot IS NULL AND ingredient_id IS NOT NULL) FROM purchase_lines
UNION ALL SELECT 'waste_records',                count(*) FILTER (WHERE ingredient_name_snapshot IS NULL AND ingredient_id IS NOT NULL) FROM waste_records
UNION ALL SELECT 'stock_count_lines',            count(*) FILTER (WHERE ingredient_name_snapshot IS NULL AND ingredient_id IS NOT NULL) FROM stock_count_lines;
