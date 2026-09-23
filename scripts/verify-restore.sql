-- Integrity checks for a *restored copy* of the database. Run by
-- scripts/verify-backup.sh against a throwaway database, never the live one.
-- Structural problems stop with an error; data-quality findings are listed
-- as WARN for a person to judge.
\set ON_ERROR_STOP on
\pset footer off

\echo '== Schema'
select count(*) as migrations_applied, max(created_at) as last_migration_ms from drizzle.__drizzle_migrations;

do $$
begin
  if (select count(*) from drizzle.__drizzle_migrations) = 0 then
    raise exception 'No migrations recorded: this is not a CaféOps database dump.';
  end if;
  if (select count(*) from users) = 0 or (select count(*) from businesses) = 0 then
    raise exception 'The restored database has no users or no businesses.';
  end if;
end $$;

\echo '== Row counts'
select 'businesses' as "table", count(*) from businesses
union all select 'users', count(*) from users
union all select 'memberships', count(*) from memberships
union all select 'orders', count(*) from orders
union all select 'order_lines', count(*) from order_lines
union all select 'inventory_movements', count(*) from inventory_movements
union all select 'purchases', count(*) from purchases
union all select 'expenses', count(*) from expenses
union all select 'audit_logs', count(*) from audit_logs;

\echo '== Latest activity (compare with what you expect the backup to contain)'
select (select max(created_at) from orders) as last_order_at,
       (select max(created_at) from inventory_movements) as last_movement_at,
       (select max(created_at) from audit_logs) as last_audit_at;

\echo '== Data checks (PASS / WARN)'
-- Every stock change is a ledger row, so cached stock should equal the
-- ledger sum. WARN, not FAIL: stock set outside the app (seed scripts,
-- manual SQL) shows up here and needs a person to decide.
select 'stock matches ledger' as "check",
       case when count(*) = 0 then 'PASS' else 'WARN' end as result,
       count(*) as rows_flagged
from ingredients g
left join (select ingredient_id, sum(quantity_base_units) as moved from inventory_movements group by ingredient_id) m on m.ingredient_id = g.id
where g.current_quantity_base_units <> coalesce(m.moved, 0)
union all
select 'order subtotals match their lines',
       case when count(*) = 0 then 'PASS' else 'WARN' end, count(*)
from orders o
left join (select order_id, sum(line_total) as s from order_lines group by order_id) l on l.order_id = o.id
where o.status <> 'DRAFT' and o.subtotal <> coalesce(l.s, 0)
union all
select 'every business has an active owner',
       case when count(*) = 0 then 'PASS' else 'WARN' end, count(*)
from businesses b
where not exists (
  select 1 from memberships m
  join membership_roles mr on mr.membership_id = m.id
  join roles r on r.id = mr.role_id and r.name in ('owner', 'super_admin')
  join users u on u.id = m.user_id and u.active
  where m.business_id = b.id and m.active
)
union all
select 'at most one active recipe per variant',
       case when count(*) = 0 then 'PASS' else 'WARN' end, count(*)
from (select menu_item_variant_id from recipes where active group by 1 having count(*) > 1) x;
