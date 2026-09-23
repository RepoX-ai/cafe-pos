-- Representative, fictional multi-tenant data for EXPLAIN evidence and the
-- mixed-workload performance test. Run only through scripts/perf/seed.ts,
-- which refuses any database whose name does not contain "perf".
--
-- Parameters (psql-style, substituted by the runner):
--   :businesses        number of tenants
--   :days              days of order history per tenant
--   :orders_per_day    orders per tenant per day
-- Shape per tenant: 6 categories, 40 items x 2 variants, 30 ingredients,
-- 3-line recipes, 3 modifier groups x 4 options (one option in three has a
-- recipe line), 2.5 lines per order on average, ~0.6 modifiers per line,
-- one consumption row + one ledger row per recipe line, plus purchases,
-- waste and expenses.
select setseed(0.42);

create temporary table perf_biz as
select gen_random_uuid() as id, g as n from generate_series(1, :businesses) g;

insert into businesses (id, name, order_number_prefix)
select id, 'Perf Café ' || n, 'P' || n from perf_biz;

insert into locations (id, business_id, name) select gen_random_uuid(), id, 'Main Store' from perf_biz;

insert into menu_categories (id, business_id, name, display_order)
select gen_random_uuid(), b.id, 'Category ' || c, c from perf_biz b, generate_series(1, 6) c;

insert into ingredients (id, business_id, name, base_unit, current_quantity_base_units, average_cost_per_base_unit, reorder_level_base_units)
select gen_random_uuid(), b.id, 'Ingredient ' || i, 'gram', 100000000, (5 + i % 20)::numeric / 10, 1000
from perf_biz b, generate_series(1, 30) i;

insert into menu_items (id, business_id, category_id, name, base_price, display_order)
select gen_random_uuid(), b.id,
       (select c.id from menu_categories c where c.business_id = b.id order by c.display_order offset (i % 6) limit 1),
       'Item ' || i, 20000 + (i % 10) * 2500, i
from perf_biz b, generate_series(1, 40) i;

insert into menu_item_variants (id, menu_item_id, name, price, display_order)
select gen_random_uuid(), m.id, v.name, m.base_price + v.extra, v.ord
from menu_items m join perf_biz b on b.id = m.business_id,
     (values ('Regular', 0, 0), ('Large', 5000, 1)) as v(name, extra, ord);

insert into recipes (id, business_id, menu_item_variant_id, version, active)
select gen_random_uuid(), m.business_id, v.id, 1, true
from menu_item_variants v join menu_items m on m.id = v.menu_item_id join perf_biz b on b.id = m.business_id;

insert into recipe_lines (id, business_id, recipe_id, ingredient_id, quantity_base_units)
select gen_random_uuid(), r.business_id, r.id, g.id, 5 + (row_number() over () % 20)
from recipes r join perf_biz b on b.id = r.business_id
cross join lateral (
  select id from ingredients i where i.business_id = r.business_id
  order by md5(r.id::text || i.id::text) limit 3
) g;

insert into modifier_groups (id, business_id, name, max_selections)
select gen_random_uuid(), b.id, 'Group ' || g, 2 from perf_biz b, generate_series(1, 3) g;

insert into modifier_options (id, modifier_group_id, name, price_adjustment, display_order)
select gen_random_uuid(), g.id, g.name || ' option ' || o, o * 1000, o
from modifier_groups g join perf_biz b on b.id = g.business_id, generate_series(1, 4) o;

insert into modifier_recipe_lines (id, business_id, modifier_option_id, ingredient_id, quantity_base_units)
select gen_random_uuid(), g.business_id, o.id,
       (select id from ingredients i where i.business_id = g.business_id order by md5(o.id::text || i.id::text) limit 1), 3
from modifier_options o join modifier_groups g on g.id = o.modifier_group_id join perf_biz b on b.id = g.business_id
where o.display_order = 1;

insert into menu_item_modifier_groups (id, business_id, menu_item_id, modifier_group_id, display_order)
select gen_random_uuid(), m.business_id, m.id, g.id, 0
from menu_items m join perf_biz b on b.id = m.business_id
join modifier_groups g on g.business_id = m.business_id and g.name = 'Group ' || (1 + (m.display_order % 3));

-- Orders: :days of history ending yesterday, spread over opening hours.
create temporary table perf_orders as
select gen_random_uuid() as id, b.id as business_id, b.n,
       row_number() over (partition by b.id order by d, k) as seq,
       (current_date - d) + time '08:00' + (k * ((12 * 3600) / :orders_per_day)) * interval '1 second' + (random() * interval '30 seconds') as local_ts
from perf_biz b, generate_series(1, :days) d, generate_series(1, :orders_per_day) k;

create temporary table perf_lines as
select gen_random_uuid() as id, o.id as order_id, o.business_id, v.id as variant_id, m.id as item_id,
       m.name as item_name, v.name as variant_name, c.name as category_name, v.price, 1 + (random() * 2)::int as quantity,
       m.display_order as item_order
from perf_orders o
cross join lateral generate_series(1, 1 + (random() * 3)::int) as l
cross join lateral (select floor(random() * 40)::int + 1 as item_n, floor(random() * 2)::int as var_n offset 0 * l) as pick
join menu_items m on m.business_id = o.business_id and m.display_order = pick.item_n
join menu_item_variants v on v.menu_item_id = m.id and v.display_order = pick.var_n
left join menu_categories c on c.id = m.category_id;

create temporary table perf_mods as
select gen_random_uuid() as id, l.id as line_id, opt.id as option_id, opt.name, opt.price_adjustment
from perf_lines l
join menu_item_modifier_groups a on a.menu_item_id = l.item_id
join lateral (
  select o.* from modifier_options o where o.modifier_group_id = a.modifier_group_id
  order by random() limit 1
) opt on random() < 0.6;

insert into orders (id, business_id, order_number, status, order_type, subtotal, total, cogs_total, gross_profit,
                    payment_method_label, idempotency_key, created_at)
select o.id, o.business_id, 'P' || o.n || '-' || lpad(o.seq::text, 6, '0'),
       case when random() < 0.02 then 'CANCELLED'::order_status else 'COMPLETED'::order_status end,
       'dine_in', 0, 0, 0, 0, (array['cash', 'qris', 'card'])[1 + floor(random() * 3)::int],
       gen_random_uuid()::text, o.local_ts at time zone 'Asia/Jakarta'
from perf_orders o;

insert into order_number_counters (business_id, last_number)
select business_id, max(seq) from perf_orders group by business_id;

insert into order_lines (id, order_id, menu_item_id, menu_item_variant_id, item_name_snapshot, variant_name_snapshot,
                         category_name_snapshot, quantity, unit_price_snapshot, line_total, cogs_snapshot, gross_profit_snapshot)
select l.id, l.order_id, l.item_id, l.variant_id, l.item_name, l.variant_name, l.category_name, l.quantity,
       l.price + coalesce(md.adj, 0), (l.price + coalesce(md.adj, 0)) * l.quantity,
       (l.price * l.quantity) / 3, (l.price * l.quantity) * 2 / 3
from perf_lines l
left join (select line_id, sum(price_adjustment) as adj from perf_mods group by line_id) md on md.line_id = l.id;

insert into order_line_modifiers (id, order_line_id, modifier_option_id, modifier_name_snapshot, price_adjustment_snapshot)
select id, line_id, option_id, name, price_adjustment from perf_mods;

update orders o set subtotal = t.s, total = t.s, cogs_total = t.c, gross_profit = t.s - t.c
from (select order_id, sum(line_total) as s, sum(cogs_snapshot) as c from order_lines l join perf_orders p on p.id = l.order_id group by order_id) t
where o.id = t.order_id;

-- One ledger row and one consumption row per recipe line of each order line.
create temporary table perf_consumption as
select gen_random_uuid() as movement_id, l.order_id, l.id as line_id, l.business_id, rl.ingredient_id,
       rl.quantity_base_units * l.quantity as qty, o.local_ts
from perf_lines l
join perf_orders o on o.id = l.order_id
join recipes r on r.menu_item_variant_id = l.variant_id and r.active
join recipe_lines rl on rl.recipe_id = r.id;

insert into inventory_movements (id, business_id, ingredient_id, ingredient_name_snapshot, ingredient_base_unit_snapshot,
                                 movement_type, quantity_base_units, unit_cost, total_cost, source_type, source_id, created_at)
select c.movement_id, c.business_id, c.ingredient_id, 'Ingredient', 'gram', 'SALE_CONSUMPTION', -c.qty, 1, c.qty::int,
       'order', c.order_id, c.local_ts at time zone 'Asia/Jakarta'
from perf_consumption c;

insert into order_ingredient_consumption (id, order_id, order_line_id, ingredient_id, ingredient_name_snapshot,
                                          ingredient_base_unit_snapshot, quantity_base_units, unit_cost_snapshot, total_cost, inventory_movement_id)
select gen_random_uuid(), c.order_id, c.line_id, c.ingredient_id, 'Ingredient', 'gram', c.qty, 1, c.qty::int, c.movement_id
from perf_consumption c;

insert into suppliers (id, business_id, name) select gen_random_uuid(), id, 'Supplier ' || n from perf_biz;

insert into purchases (id, business_id, supplier_id, purchase_date, status, total_cost, finalized_at, created_at)
select gen_random_uuid(), b.id, s.id, current_date - d, 'FINALIZED', 500000, now() - d * interval '1 day', now() - d * interval '1 day'
from perf_biz b join suppliers s on s.business_id = b.id, generate_series(1, :days, 3) d;

insert into waste_records (id, business_id, ingredient_id, quantity_base_units, reason, estimated_cost, created_at)
select gen_random_uuid(), b.id, (select id from ingredients i where i.business_id = b.id limit 1), 50, 'spilled', 5000, now() - d * interval '1 day'
from perf_biz b, generate_series(1, :days) d;

insert into expenses (id, business_id, category, amount, expense_date)
select gen_random_uuid(), b.id, (array['rent', 'salary', 'electricity', 'other'])[1 + d % 4], 250000, current_date - d
from perf_biz b, generate_series(1, :days) d;

analyze;
