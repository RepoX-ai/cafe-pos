# CaféOps

Café point-of-sale, recipe inventory, COGS, and profit management system.
Built against [docs/cafe-erp-prd.md](docs/cafe-erp-prd.md).

**Status:** Phase 0 (Foundation) complete. Auth, permissions, full database
schema, Docker, and test tooling are in place. POS, menu/recipe UI,
purchasing, printing, and the dashboard are not built yet — see
[Implementation phases](#implementation-phases).

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
- [ ] **Phase 5 — Dashboard & reports**: sales/COGS/profit dashboard,
      expenses, CSV exports.
- [ ] **Phase 6 — Hardening & pilot**: full e2e suite, concurrency
      testing, backup/restore drill, staging + production deployment.

## Deployment

- **Local**: Docker Compose (above), or Node + any Postgres.
- **Staging**: Vercel (app) + any managed Postgres (Supabase, Neon, RDS,
  ...) — set `DATABASE_URL` and the rest of `.env.example` as project env
  vars, then run `npm run db:migrate` once against the staging database.
- **Production**: this repo has no Vercel-only or Supabase-Edge-only
  dependencies, so it deploys the same way to a Linux VPS — either via
  Docker (`docker compose up --build -d` behind an Nginx reverse proxy
  with TLS) or `npm run build && npm start` under a process manager
  (pm2/systemd).

Open hardware/business decisions (printer model, tax-inclusive pricing,
service charge, negative-stock policy, etc.) are listed in PRD §20 and are
intentionally left as configuration points rather than hardcoded
assumptions — see `businesses.tax_config`, `businesses.allow_negative_stock`,
and `PRINT_PROVIDER` in `.env.example`.
