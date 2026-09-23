-- Custom SQL migration file, put your code below! --
-- Backfills menu_item_modifier_groups.business_id from the owning menu item,
-- then refuses to continue if existing data would violate the tenant and
-- recipe constraints added by the next migration. Nothing is deleted or
-- rewritten here: a failure rolls the whole migration run back and names
-- the offending rows. See docs/tenant-integrity-migration.md.
UPDATE "menu_item_modifier_groups" AS a
SET "business_id" = i."business_id"
FROM "menu_items" AS i
WHERE i."id" = a."menu_item_id" AND a."business_id" IS NULL;
--> statement-breakpoint
DO $$
DECLARE
  problems text := '';
  n bigint;
  sample text;
BEGIN
  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT i.id, row_number() OVER () AS rn
    FROM menu_items i JOIN menu_categories c ON c.id = i.category_id
    WHERE c.business_id <> i.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- menu_items.category_id points at another business''s category: %s row(s), e.g. menu_items.id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT a.id, row_number() OVER () AS rn
    FROM menu_item_modifier_groups a JOIN modifier_groups g ON g.id = a.modifier_group_id
    WHERE g.business_id <> a.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- menu_item_modifier_groups assigns another business''s modifier group: %s row(s), e.g. id %s', n, sample); END IF;

  SELECT count(*), string_agg(v::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT menu_item_id AS v, row_number() OVER () AS rn
    FROM menu_item_modifier_groups GROUP BY menu_item_id, modifier_group_id HAVING count(*) > 1) s;
  IF n > 0 THEN problems := problems || format(E'\n- the same modifier group is assigned twice to a menu item: %s case(s), e.g. menu_item_id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT l.id, row_number() OVER () AS rn
    FROM recipe_lines l JOIN recipes r ON r.id = l.recipe_id
    WHERE r.business_id <> l.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- recipe_lines.business_id differs from its recipe: %s row(s), e.g. id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT l.id, row_number() OVER () AS rn
    FROM recipe_lines l JOIN ingredients g ON g.id = l.ingredient_id
    WHERE g.business_id <> l.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- recipe_lines uses another business''s ingredient: %s row(s), e.g. id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT l.id, row_number() OVER () AS rn
    FROM modifier_recipe_lines l JOIN ingredients g ON g.id = l.ingredient_id
    WHERE g.business_id <> l.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- modifier_recipe_lines uses another business''s ingredient: %s row(s), e.g. id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT p.id, row_number() OVER () AS rn
    FROM purchases p JOIN suppliers s ON s.id = p.supplier_id
    WHERE s.business_id <> p.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- purchases.supplier_id points at another business''s supplier: %s row(s), e.g. purchases.id %s', n, sample); END IF;

  SELECT count(*), string_agg(id::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT g.id, row_number() OVER () AS rn
    FROM ingredients g JOIN suppliers s ON s.id = g.preferred_supplier_id
    WHERE s.business_id <> g.business_id) s;
  IF n > 0 THEN problems := problems || format(E'\n- ingredients.preferred_supplier_id points at another business''s supplier: %s row(s), e.g. ingredients.id %s', n, sample); END IF;

  SELECT count(*), string_agg(v::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT menu_item_variant_id AS v, row_number() OVER () AS rn
    FROM recipes WHERE active GROUP BY menu_item_variant_id HAVING count(*) > 1) s;
  IF n > 0 THEN problems := problems || format(E'\n- more than one active recipe for a variant: %s variant(s), e.g. menu_item_variant_id %s', n, sample); END IF;

  SELECT count(*), string_agg(v::text, ', ') FILTER (WHERE rn <= 5) INTO n, sample FROM (
    SELECT menu_item_variant_id AS v, row_number() OVER () AS rn
    FROM recipes GROUP BY menu_item_variant_id, version HAVING count(*) > 1) s;
  IF n > 0 THEN problems := problems || format(E'\n- duplicate recipe version numbers for a variant: %s case(s), e.g. menu_item_variant_id %s', n, sample); END IF;

  IF problems <> '' THEN
    RAISE EXCEPTION 'Tenant/recipe integrity preflight failed; no changes were applied.%', problems
      USING HINT = 'Inspect and correct these rows by hand (the queries are in docs/tenant-integrity-migration.md), then rerun npm run db:migrate. The migration never deletes or rewrites them for you.';
  END IF;
END $$;
