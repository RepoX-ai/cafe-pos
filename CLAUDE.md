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
8. This install is **multi-tenant**. The business for a request comes from
   the session row (`sessions.active_membership_id` → `memberships` →
   `businesses`), surfaced as `SessionUser.businessId`. Never let a
   tenant be named by a URL segment, form field, header or action
   argument — the only thing a client may send is a membership id to
   switch to, and that is re-checked against the session's own user.
   Every tenant-owned table carries `business_id`; new ones must too, and
   every read and write filters on it. A user is an identity, not a staff
   record: their access, roles and active flag are per-business
   (`memberships`), while name/email/password are theirs alone — see the
   `linkedElsewhere` rules in `src/server/services/staff-service.ts`
   before adding anything that writes to `users`.
9. Submitted orders are historical snapshots. Never make an order page
   recompute price/COGS from the *current* menu/recipe/cost — it must
   read the snapshot columns on `orders` / `order_lines` /
   `order_ingredient_consumption`.
10. Display times in Asia/Jakarta (`src/lib/dates`); store timestamps in
   UTC (`timestamptz` everywhere in the schema).
11. No Vercel-only or Supabase-Edge-only APIs in core logic — this app
    must run identically via `docker compose` or plain `next start` on a
    VPS.

## A gotcha that already bit once

Don't export plain data (arrays, objects, constants — anything that
isn't a component) from a `"use client"` file for a Server Component to
import. Next.js turns every export of a client module into a client
reference when consumed from the server side of the RSC boundary, so a
Server Component importing it gets a proxy, not the real value —
`someArray.filter(...)` throws at runtime. It compiles fine and
`next build` won't catch it either if the route is dynamic/auth-gated
(build doesn't render those). Only an actual request — or an e2e test —
surfaces it. This happened with `NAV_ITEMS` (moved to
`src/lib/navigation.ts`, a plain module, imported by both the client
`AdminShell` component and the server `(dashboard)/layout.tsx`). If you
add more shared nav/config data, put it in a plain `.ts` file, never in
a `"use client"` component file.

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
  business logic, unit-tested in `tests/unit/`. `auth/session.ts` also
  owns membership resolution and business switching.
- `src/server/services/` — DB-touching business logic (auth, audit log so
  far; order/inventory/purchasing workflows land here in later phases).
- `src/app/` — routes. `(auth)/login` is public; everything else calls
  `requirePageAccess(permission?)` at the top of the page.
