# Security / ops notes (audit Low & Info)

Short operator-facing notes for findings that are intentional product
behaviour or deliberately left as per-route discipline rather than new
infrastructure. Critical/Medium remediations live on PR #3 / this branch;
this file only covers Low/Info choices.

## SEC-009 — Staff email presence (intentional)

Staff create/update can reveal that an email already has a CaféOps account
(link existing user, “already on your staff list”, email clash on rename).
That is **intentional** for multi-café installs: one person, one login, many
memberships (see README “Shared accounts”). Login itself does **not**
enumerate accounts (SEC-004 timing pad + generic messages).

Do not “hide” staff-email collisions without a product redesign of linking;
owners/managers need to know they are attaching an existing login.

## CQ-002 — No root `middleware.ts` (intentional)

Authz stays on **per-route** `requirePageAccess` / Server Action checks
(`src/lib/auth/guards.ts` and service-layer permissions). A global Next.js
middleware would either duplicate that model poorly or become a large
rewrite. Keep adding guards on new pages/actions; do not rely on nav alone.

## DB-002 — Ingredients low-stock composite index (skipped)

Low-stock SQL filters on `business_id`, `active`, non-null reorder level,
and `current_quantity_base_units <= reorder_level_base_units` (plus
out-of-stock `<= 0`). A plain composite cannot express the cross-column
predicate well; a partial index would churn on every stock movement.
Café catalogs are small and already covered by `ingredients_business_id_idx`.
Revisit only if a tenant’s ingredient table is large enough that alerts
show up in slow-query logs.

## SEC-010 / RL-002 — Rate limits (Info / positive)

PostgreSQL-backed rate limits already cover login and the sensitive
mutation paths extended under RL-001. No further code change for these
Info items.

## PERF-002 — Dashboard query fan-out (light touch only)

Dashboard already loads independent report queries via `Promise.all`.
Menu thumbnails stay a follow-up query because they need ranking IDs.
Further coalescing is deferred unless profiling shows a real bottleneck.
