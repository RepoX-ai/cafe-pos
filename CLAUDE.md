@AGENTS.md

# CaféOps

Café POS / recipe-inventory / COGS / profit system. Full spec is
[docs/cafe-erp-prd.md](docs/cafe-erp-prd.md) — read it before making
product decisions; this file is quick orientation, not a replacement for it.

See [README.md](README.md) for setup, scripts, and phase-by-phase status.

## Non-negotiable rules from the PRD (do not relax these while extending the app)

1. Money at rest is always a whole-Rupiah **integer** column. Never a
   float. Internal math uses `src/lib/money` (bigint "micro-Rupiah" fixed
   point) and rounds to a whole Rupiah only when persisting/displaying.
2. Ingredient quantities and cost-per-unit rates are exact Postgres
   `numeric`, in base units only: gram / millilitre / piece
   (`src/lib/units`).
3. Inventory changes are **append-only** (`inventory_movements`). Never
   write to `ingredients.current_quantity_base_units` without also
   inserting a movement row that says why.
4. Every stock-affecting action (order submit, cancel, purchase finalize,
   waste, stock count) runs inside one DB transaction.
5. Order submission, cancellation, and print-job creation must be
   idempotent — the client-supplied idempotency key on `orders` is the
   mechanism for submission; re-check this pattern before adding new
   mutating flows that a flaky iPad connection might retry.
6. Permissions are **allowlist-based** (`src/lib/permissions`): add a
   permission to `ROLE_PERMISSIONS` explicitly, never assume access
   because a role isn't denied. Enforce with `requirePageAccess` /
   `requirePermission` in the Server Component/Action itself — the UI
   hiding a nav link is not enforcement.
7. Sessions are DB-backed (`src/lib/auth/session.ts`), not JWT, so that a
   deactivated user loses access on the next request. Don't introduce a
   stateless/JWT session path — it would break that guarantee.
8. Submitted orders are historical snapshots. Never make an order page
   recompute price/COGS from the *current* menu/recipe/cost — it must
   read the snapshot columns on `orders` / `order_lines` /
   `order_ingredient_consumption`.
9. Display times in Asia/Jakarta (`src/lib/dates`); store timestamps in
   UTC (`timestamptz` everywhere in the schema).
10. No Vercel-only or Supabase-Edge-only APIs in core logic — this app
    must run identically via `docker compose` or plain `next start` on a
    VPS.

## Design tokens

Colors, spacing, and radii are CSS custom properties in
`src/app/globals.css` (`--color-*`, `--space-*`, `--radius-*`) — light
theme only for the MVP per the PRD; don't hardcode hex values in
components. Font is Geist (already wired in `layout.tsx`).

## Where things live

- `src/lib/db/schema/` — Drizzle schema, one file per domain, barrel at
  `index.ts`. `drizzle/migrations/` is generated (`npm run db:generate`),
  never hand-edited.
- `src/lib/{money,units,dates,permissions,auth}/` — framework-agnostic
  business logic, unit-tested in `tests/unit/`.
- `src/server/services/` — DB-touching business logic (auth, audit log so
  far; order/inventory/purchasing workflows land here in later phases).
- `src/app/` — routes. `(auth)/login` is public; everything else calls
  `requirePageAccess(permission?)` at the top of the page.
