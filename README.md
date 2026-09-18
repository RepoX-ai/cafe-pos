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
| `npm run db:migrate-to <tag>` | Apply migrations up to one tag and stop (for upgrades with a data step in the middle) |
| `npm run db:seed` | Insert development seed data (idempotent) |
| `npm run db:create-owner` | Create a business + owner account (run again for each additional café) |
| `npm run db:backfill-memberships` | One-off: move `users.business_id` / `user_roles` onto `memberships` (see Multi-tenancy) |
| `npm run db:cleanup-rate-limits` | Delete expired rate-limit buckets (optional cron; the app also cleans up after requests) |
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
  takes effect immediately. Anyone signed in can change their own password
  from the account menu (`/account/password`); it proves the current
  password first and signs out every *other* session of that account.
- **One install serves several independent cafés.** Every tenant-owned row
  carries `business_id`, and a request's business comes from its session
  row — never from a URL, form field or header — so no request can name
  its own tenant. Access is a `memberships` row (user × business, with the
  roles for that business), so one person can own café A and cash up at
  café B under a single login, switching from the account menu. See
  **Multi-tenancy** below.
- **Concurrency**: checkout, cancellation/refund, purchases and stock counts
  lock ingredient rows in ingredient-id order (reversals lock the order row
  first), so competing requests serialize instead of double-applying stock.
  Order numbers come from a per-business counter row
  (`order_number_counters`), locked only from number allocation to commit.
- **Growing lists are paginated on the server** (`?page=N`, 20 rows, newest
  first with an id tie-breaker); CSV exports stream every matching row in
  batches from one read-only snapshot.
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

## Multi-tenancy

One deployment, one database, several independent cafés. Nothing is shared
between them but the `roles` catalogue and the login page.

### How a request finds its tenant

`sessions.active_membership_id` points at one `memberships` row, and that
row names the business. `validateSessionToken` joins through it and returns
`SessionUser.businessId`, which every page, action and service already
takes as "the tenant for this request". The client never supplies it, so
there is no request in which a caller can aim at a business they don't
belong to — including the business switcher, which re-checks the
membership against the session's own user before moving anything.

Revoking access is `memberships.active = false`. Sessions pinned to that
membership stop validating on the very next request, and the same person's
sessions at their *other* cafés are untouched.

### Adding a café

An Owner can do it themselves, in the app: **Settings → Your businesses →
Add a business**. They become its Owner, and it starts empty — no menu, no
ingredients, no other staff. Nothing is copied from the café they were in,
because businesses are independent tenants.

That is gated on the `business:create` permission, which only `owner` and
`super_admin` hold. It is the one permission that reaches beyond the
caller's own business; a Manager with `settings:write` can edit the café
they are in but cannot create another.

From a terminal (first café on a fresh database, or scripted provisioning):

```bash
npm run db:create-owner      # prompts, or BUSINESS_NAME/OWNER_EMAIL/... in a non-TTY
```

Either way, if the owner's email already has a CaféOps account it is
linked to the new business instead of duplicated — one login, one password
they control, an owner role per café.

### Switching café

The account menu (top right) in the admin shell, and the **store dropdown
on the logo** in the POS header. Both only appear when the signed-in
account holds more than one membership.

Switching moves `sessions.active_membership_id` for **that browser only**,
so changing café on the office laptop does not drag the POS tablet with
it. The POS refuses to switch while an order is submitted but unconfirmed,
since the retry banner lives on that store's POS; a cart in progress is
safe either way, because the draft is saved per business and comes back.

### Shared accounts

Someone who works at two cafés has **one** `users` row and two
memberships. Their role, their active/suspended state and their history
are per-café; their name, email and password are not, and belong to them.
So the staff screen refuses to let café A rename, re-email or reset the
password of an account that also works at café B (the role is still café
A's to set), and "remove" takes away the membership rather than deleting a
login café A doesn't own. Those rules are in
`src/server/services/staff-service.ts` and covered by
`tests/integration/multi-tenancy.test.ts`.

### Upgrading an existing single-tenant install

Access used to live on `users.business_id`. Moving it to `memberships`
takes three steps in this order — the middle one is a data migration that
`drizzle-kit` cannot generate:

```bash
npm run db:migrate-to 0010_add_memberships_and_tenant_columns   # additive; safe while the app is up
npm run db:backfill-memberships                                 # moves the data across, clears sessions
npm run db:migrate                                              # 0011 — drops the old columns
```

The first step is `db:migrate-to`, not `db:migrate`, and that matters:
`db:migrate` runs *every* pending migration in one transaction, so on an
install that is more than one migration behind it would reach 0011 before
the backfill has run, fail its `NOT NULL` checks, and roll 0010 back with
it. `db:migrate-to` stops at the tag you name and records it exactly the
way drizzle does, so the final `db:migrate` picks up cleanly from there.

Everyone signs in again once afterwards; that is deliberate, and it is why
no half-migrated session can resolve to the wrong business. Deploy the new
code together with step 3 — between the backfill and 0011 the old code
still runs, but after 0011 it cannot.

The backfill also fills the `business_id` columns added to `recipes`,
`recipe_lines`, `modifier_recipe_lines` and `print_jobs`. Those four used
to reach their tenant only by joining (variant → item, job → order), which
every query had to remember; they now carry it directly.

### Per-business branding

Each business has its own logo and accent colour, set in **Settings →
Branding**, so a restaurant and a coffee shop on the same install don't
have to look alike.

- **Logo** replaces the wordmark in the admin sidebar and the POS header.
  Stored under that business's own folder (`/media/brand/<businessId>/…`),
  so one café's assets can be exported or deleted as a unit. The bundled
  wordmark is the fallback when none is set.
- **Accent colour** is one hex value. The hover shade and the text colour
  that sits on top of it are *derived* from it at render time
  (`src/lib/branding/branding.ts`) rather than stored, so they cannot drift
  apart — and the foreground is picked by WCAG contrast, so a pale accent
  gets black text instead of unreadable white. The form warns when neither
  black nor white clears 4.5:1, but still saves: it's the owner's brand.
  Applied as `--color-accent-*` custom properties on the shell, so nothing
  hardcodes a hex.
- **Receipt logo** prints on thermal receipts as a 1-bit `GS v 0` raster.

The login page keeps the bundled wordmark: there is no session yet, so the
tenant is unknown at that point.

#### Why the receipt logo is rasterised in the browser

A thermal printer takes a packed 1-bit bitmap, not a PNG. The conversion
happens **once, in the browser, when the logo is uploaded** — a canvas
scales it to the paper's 384-dot width and dithers it (Floyd–Steinberg, so
photos and gradients survive) — and the packed bytes are stored on the
business row.

That keeps every print path free of an image decoder: no `sharp` on the
server, nothing extra on the Android tablet printing over Bluetooth, and no
receipt that depends on fetching and decoding a PNG mid-sale. The owner
also sees a preview of exactly what will print before saving.

The raster is **not** stored on each print job. A dithered raster is about
10KB and barely compresses, and storing it per job made every print job
17× larger — roughly 3GB a year across five cafés — for a cosmetic. It is
attached from the business row as the payload is handed to a printer, so
a reprint shows the café's current logo. Prices, lines and totals stay
snapshotted per job as PRD rule 8 requires; only the logo is read live.
Kitchen tickets never get one.

#### Uploads need storage configured

Logo and menu-photo uploads are inert unless `STORAGE_PROVIDER` is set —
`local` for a VPS or dev machine with durable disk, `s3` for anything
serverless. With neither, the UI says so and offers a pasted URL instead.

### Not done here

Row-level security. Tenant isolation is enforced in application code, and
every tenant table now has a `business_id` for a Postgres RLS policy to
key off — but the policies and the `set local app.business_id` wrapper
aren't written. Until they are, a service function that forgets its
`.where(eq(..., businessId))` is a cross-tenant leak that nothing below it
would catch.

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
