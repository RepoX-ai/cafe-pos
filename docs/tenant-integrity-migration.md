# Tenant-integrity migration (0015–0018)

These migrations make the database itself refuse cross-tenant references:
a menu item can only use its own business's category, an item can only be
assigned its own business's modifier groups, recipe lines can only use their
own business's recipe and ingredients, and a purchase or an ingredient can
only name its own business's supplier. They also allow at most one active
recipe per variant and no repeated version numbers.

Migration **0016** checks existing data first. If anything would violate the
new constraints it stops with a message like:

```
Migration failed: Tenant/recipe integrity preflight failed; no changes were applied.
- recipe_lines uses another business's ingredient: 1 row(s), e.g. id ac97f883-...
Hint: Inspect and correct these rows by hand ...
```

The whole migration run is one transaction, so **nothing** from 0015 onwards
is applied, and the app keeps running on the previous schema. Nothing is
deleted or rewritten automatically: every row it names is either a data bug
or deliberate test data, and only you can tell which.

## Before you start

Take a backup (see [backup-restore.md](backup-restore.md)). Run the queries
below with the owner credentials (`docker compose exec db psql -U postgres -d cafe_pos`).

## Inspect and fix, per message

Each block shows the rows, then the usual correction. Decide per row.

### `menu_items.category_id points at another business's category`

```sql
select i.id, i.name, i.business_id, c.name as category, c.business_id as category_business
from menu_items i join menu_categories c on c.id = i.category_id
where c.business_id <> i.business_id;

-- Usual fix: un-categorise the item (its business can re-categorise it in the UI).
update menu_items set category_id = null where id = '<menu_items.id>';
```

### `menu_item_modifier_groups assigns another business's modifier group`

```sql
select a.id, i.name as item, i.business_id, g.name as group_name, g.business_id as group_business
from menu_item_modifier_groups a
join menu_items i on i.id = a.menu_item_id
join modifier_groups g on g.id = a.modifier_group_id
where g.business_id <> i.business_id;

-- Usual fix: remove the assignment.
delete from menu_item_modifier_groups where id = '<id>';
```

### `the same modifier group is assigned twice to a menu item`

```sql
select menu_item_id, modifier_group_id, array_agg(id) from menu_item_modifier_groups
group by 1, 2 having count(*) > 1;

-- Keep one of each pair:
delete from menu_item_modifier_groups where id = '<one of the duplicate ids>';
```

### `recipe_lines.business_id differs from its recipe` / `recipe_lines uses another business's ingredient`

```sql
select l.id, l.business_id, r.business_id as recipe_business, g.name as ingredient, g.business_id as ingredient_business
from recipe_lines l
join recipes r on r.id = l.recipe_id
join ingredients g on g.id = l.ingredient_id
where r.business_id <> l.business_id or g.business_id <> l.business_id;

-- Usual fix: delete the line (a recipe is a forward-looking instruction;
-- past orders keep their own consumption snapshots), then re-add the right
-- ingredient in the recipe editor.
delete from recipe_lines where id = '<id>';
```

### `modifier_recipe_lines uses another business's ingredient`

```sql
select l.id, l.business_id, g.name as ingredient, g.business_id as ingredient_business
from modifier_recipe_lines l join ingredients g on g.id = l.ingredient_id
where g.business_id <> l.business_id;

delete from modifier_recipe_lines where id = '<id>';
```

### `purchases.supplier_id` / `ingredients.preferred_supplier_id points at another business's supplier`

```sql
select p.id, p.business_id, s.name as supplier, s.business_id as supplier_business
from purchases p join suppliers s on s.id = p.supplier_id where s.business_id <> p.business_id;

select g.id, g.name, g.business_id, s.name as supplier, s.business_id as supplier_business
from ingredients g join suppliers s on s.id = g.preferred_supplier_id where s.business_id <> g.business_id;

-- Usual fix: clear the reference (the purchase keeps its lines, totals and stock effect).
update purchases set supplier_id = null where id = '<id>';
update ingredients set preferred_supplier_id = null where id = '<id>';
```

### `more than one active recipe for a variant` / `duplicate recipe version numbers`

```sql
select menu_item_variant_id, array_agg(id order by version), array_agg(version order by version), array_agg(active order by version)
from recipes group by menu_item_variant_id
having count(*) filter (where active) > 1 or count(*) <> count(distinct version);

-- Keep the newest active; deactivate the others. Renumber duplicates if needed.
update recipes set active = false where id = '<older active recipe id>';
update recipes set version = <unused number> where id = '<duplicate id>';
```

Orders never read recipes after they are submitted, so neither fix changes
any historical order, receipt or report.

## Then

```bash
docker compose run --rm migrate      # or: npm run db:migrate
```

Repeat until the preflight passes. On success it prints `Migrations complete.`
