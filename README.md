# CaféOps

Café point-of-sale, recipe inventory, COGS, and profit management system.
Built against [docs/cafe-erp-prd.md](docs/cafe-erp-prd.md).

**Status:** All 7 PRD phases (0–6) implemented — schema, auth/permissions,
menu/recipes, inventory, POS order workflow, printing, dashboard/reports,
and staff/audit/hardening. See [Implementation phases](#implementation-phases)
for what each phase covers and [Known limitations](#known-limitations--deliberately-out-of-scope)
for what still needs a live environment to verify or wasn't built (CSV
import, real printer hardware).

## Stack

- Next.js (App Router) + TypeScript + React
- Tailwind CSS v4 (design tokens as CSS custom properties, see
  `src/app/globals.css`)
- PostgreSQL + Drizzle ORM (`src/lib/db/schema`)
- Custom DB-backed session auth (bcrypt + hashed session tokens) — not
  JWT, so a deactivated user or revoked session loses access on the very
  next request
- Vitest (unit) + Playwright (e2e)

## Local development

### Option A — Docker Compose (recommended)

```bash
docker compose up -d db          # Postgres only
cp .env.example .env             # if you haven't already
npm install
npm run db:migrate
npm run db:seed                  # creates one dev user per role, see output
npm run dev                      # http://localhost:3000
```

Or run the whole stack (app + db) in Docker:

```bash
docker compose up --build
docker compose run --rm app npm run db:migrate
docker compose run --rm app npm run db:seed
```

### Option B — Local Node + local/managed Postgres

```bash
cp .env.example .env    # edit DATABASE_URL to point at your Postgres
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

### Seeded accounts

`npm run db:seed` creates one user per role (password `ChangeMe123!`):
`owner@dev.local`, `manager@dev.local`, `cashier@dev.local`,
`inventory@dev.local`, `viewer@dev.local`. This is fictional development
data only — never run the seed script against a production database.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the Next.js dev server |
| `npm run build` / `npm start` | Production build / start |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc --noEmit` |
| `npm test` / `npm run test:watch` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright, needs a running seeded app) |
| `npm run db:generate` | Generate a new migration from schema changes |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |
| `npm run db:seed` | Insert development seed data (idempotent) |
| `npm run db:create-owner` | Create the first business + owner account on a fresh/production database |
| `npm run db:studio` | Drizzle Studio (browse the database) |

## Architecture notes

- **Money** is always a whole-Rupiah integer at rest (`src/lib/money`).
  Internal calculations use fixed-point bigint arithmetic ("micro-Rupiah"),
  never JS floats, to avoid rounding drift before rounding back to a whole
  Rupiah at the point of persistence/display.
- **Ingredient quantities and unit-cost rates** are exact Postgres
  `numeric` decimals (`src/lib/units`), since fractional base-unit
  quantities (e.g. 17.5g) and fractional cost-per-gram rates are expected.
- **Inventory is an append-only ledger** (`inventory_movements`). Nothing
  ever overwrites `ingredients.current_quantity_base_units` without also
  writing a movement row explaining why.
- **Permissions are allowlist-based** (`src/lib/permissions`): a role has
  zero access unless a permission is explicitly granted. Enforcement
  happens in Server Components/Actions via `requirePageAccess` /
  `requirePermission` — the UI hiding nav items is a convenience, not the
  security boundary.
- **Sessions are DB-backed**, not JWT (`src/lib/auth/session.ts`): only a
  SHA-256 hash of the session token lives in Postgres, and every request
  re-validates it (including the user's `active` flag) so deactivation
  takes effect immediately.
- **Historical orders never change**: menu/recipe/cost snapshots are
  copied onto the order at submission time (see `orders`, `order_lines`,
  `order_ingredient_consumption` in the schema) — editing a menu item or
  recipe later does not touch past orders.

## Implementation phases

Tracking the PRD's phased plan (§18):

- [x] **Phase 0 — Foundation**: repo, Next.js/TS/Tailwind, Postgres +
      Drizzle schema (all 30 tables), Docker, auth + sessions,
      permissions matrix, money/units/dates libs, seed data, Vitest +
      Playwright scaffolding.
- [x] **Phase 1 — Menu & ingredients**: admin shell (sidebar/nav),
      ingredient CRUD, menu categories/items/variants/modifiers CRUD,
      recipe editor with a live cost/margin preview (versioned recipes —
      editing never mutates a past version).
- [x] **Phase 2 — Inventory**: append-only movement ledger with row-level
      locking, purchases (weighted-average cost recompute per receipt),
      waste recording, manual stock adjustments, a select-count-review-
      submit stock count flow, and a low-stock view.
- [x] **Phase 3 — POS & orders**: iPad ordering UI (categories, cart,
      variant/modifier picker, draft persisted to localStorage, online/
      offline indicator), the order-submission transaction (idempotency
      key, server-side re-validation, per-line ingredient consumption
      merged across recipe + modifiers, stock lock-and-check, snapshots,
      a queued print job), /orders list + detail with COGS/gross-profit
      breakdown, and cancellation/full-refund with inventory reversal.
      Business settings (tax, service charge, negative-stock policy) are
      now configurable at /settings rather than hardcoded.
- [x] **Phase 4 — Printing**: `PrinterProvider` interface
      (`src/printing`) with mock, browser-fallback, and a documented
      hardware-bridge placeholder (waiting on PRD §20's open printer
      decisions); orders attempt printing right after submission,
      decoupled from the order transaction, with retry/reprint and a
      printer-connection test wired into /settings and /orders/[id].
- [x] **Phase 5 — Dashboard & reports**: date-ranged dashboard (summary
      cards + low/out-of-stock, top-selling, highest-COGS, recent orders,
      failed prints widgets), manual expense entry, an 11-report /reports
      page (sales by day/item/category/payment-method, cancelled/
      refunded, current & low stock, inventory movements, purchases,
      waste, expenses) each with CSV export, all excluding cancelled/
      refunded orders from sales/COGS the same way the PRD's dashboard
      formulas do.
- [x] **Phase 6 — Hardening & pilot** (the parts a solo build without a
      live café/printer/staging environment can actually do): staff
      management UI (create/deactivate/change role/reset password — a
      real MVP-acceptance-criteria gap the earlier phases had left open),
      an audit log viewer, login rate limiting, a manual permission audit
      that found and fixed a real boundary bug (see "Known limitations"
      below), backup/restore and deployment docs. Concurrency testing,
      printer testing, staff acceptance testing, and the actual staging/
      production deploy are operational steps for the café's team to run
      against real infrastructure — see the checklists in
      [docs/deployment.md](docs/deployment.md) and PRD §19.

## Known limitations / deliberately out of scope

- **CSV import** (ingredients/menu/recipes) isn't built — only CSV
  *export* (PRD §6.14/§14). For the pilot's initial data load, use the
  seed script as a template and adapt it, or ask for import to be built
  before real data entry needs it.
- **Permission-boundary bug found and fixed during Phase 6's audit**:
  cashier/inventory_staff/viewer briefly held `menu:read`, which — because
  that permission also gates the `/menu` admin section (recipe COGS and
  margins) — would have let a cashier reach cost data by navigating to
  `/menu` directly. Fixed in `src/lib/permissions/permissions.ts`; a
  regression test covers it in both `tests/unit/permissions.test.ts` and
  `tests/e2e/login.spec.ts`. Worth a careful look if you add new
  permissions that double as page guards for more than one audience.
- A hardware `PrinterProvider` isn't implemented — printer brand/model/
  connection type are still open per PRD §20. The interface and mock/
  browser fallbacks are ready; see [docs/deployment.md](docs/deployment.md#printer-hardware).

## Verified against a real database

Migrations, seed data, and the full test suite have been run against a
real PostgreSQL instance (not just reviewed): all 30 tables migrate
cleanly, `npm run db:seed` completes, all 41 unit tests + 7 integration
tests (real stock consumption, idempotent submission, insufficient-stock
blocking, cancellation reversal, weighted-average cost) + 7 Playwright
e2e tests (real browser, real login, a real order submitted through the
POS UI) pass. That run also caught and fixed one real bug:
`NAV_ITEMS` was exported from a `"use client"` file and imported into a
Server Component (`(dashboard)/layout.tsx`) — across that boundary it
became a client-reference proxy, not a plain array, so `.filter()` threw
for every authenticated non-cashier request. `next build` never caught
it because build doesn't render auth-gated dynamic routes; only an
actual authenticated request does. Fixed by moving nav data to
`src/lib/navigation.ts` (no `"use client"`), which is now also the
pattern to follow for any other plain data a Server Component needs from
a client module.

## Deployment

- **Local**: Docker Compose (above), or Node + any Postgres.
- **Staging**: Vercel (app) + any managed Postgres (Supabase, Neon, RDS,
  ...) — set `DATABASE_URL` and the rest of `.env.example` as project env
  vars, then run `npm run db:migrate` once against the staging database,
  followed by `npm run db:create-owner` to create the account you'll log
  in with. `npm run db:seed` is **not** an option here: it refuses to run
  with `NODE_ENV=production`, because it creates accounts behind a
  password that is public in this repo's history.
- **Production**: this repo has no Vercel-only or Supabase-Edge-only
  dependencies, so it deploys the same way to a Linux VPS — either via
  Docker (`docker compose up --build -d` behind an Nginx reverse proxy
  with TLS) or `npm run build && npm start` under a process manager
  (pm2/systemd).

Full step-by-step for each target, including Nginx/TLS config and log
rotation, is in [docs/deployment.md](docs/deployment.md). Backup/restore
procedure (and the drill to run before go-live) is in
[docs/backup-restore.md](docs/backup-restore.md).

Open hardware/business decisions (printer model, tax-inclusive pricing,
service charge, negative-stock policy, etc.) are listed in PRD §20 and are
intentionally left as configuration points rather than hardcoded
assumptions — see `businesses.tax_config`, `businesses.allow_negative_stock`,
and `PRINT_PROVIDER` in `.env.example`.
