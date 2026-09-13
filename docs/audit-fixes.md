# Audit fixes — 12 September 2026

Prepared against GitHub main `2187cfcc3d6f6cbca46c53d013c414bc5bf52a4f`. The existing Matsudon menu photographs and image backfill remain included. This patch has not been pushed.

## Changes

- Cart identity includes the menu item, preventing different dishes without variants from merging.
- Checkout saves its exact pending payload and idempotency key before submission. A lost response can be retried after refresh; edits are paused until that submission is resolved. Drafts are validated and scoped to the user and business. Browser storage is required for this recovery flow.
- Submission always clears its busy state. Server validation rejects missing variants when variants exist, unrelated or inactive modifier groups, duplicate options, and invalid required/minimum/maximum selections.
- A business row lock serializes submission idempotency checks and order-number allocation. Stock movements and historical pricing continue to be transactional snapshots.
- Browser printing opens a printable receipt and remains queued for user action. It does not claim paper output was confirmed. Concurrent processing of an existing print job is guarded; printed/cancelled jobs are not replayed by retry.
- Shared native dialogs provide focus containment, Escape handling and focus restoration. Select menus retain their containing dialog/theme, stay open while scrolling their own list, and fit the viewport. Disabled Select fields are excluded from form submission.
- The date picker uses Jakarta's current date. Muted text contrast improves in both themes, and dark accent buttons use a contrasting text color.
- Shared order tables and Rupiah formatting replace duplicates. Form CSS constants live in a plain module that server components can safely import. Unused category/variant actions, category-update service, stock-count listing, date/unit helpers and template SVGs were removed after checking callers.
- Login attempt limits use a shared PostgreSQL table instead of a process-local Map. The generated migration adds `login_attempts` and its expiry index.
- Photo uploads support explicit durable local storage or S3-compatible storage. Files are limited to 3MB with MIME/header checks, and Server Actions allow a 4MB request envelope. Existing relative menu image URLs can be edited without native URL-field rejection.
- Docker includes the source modules needed by maintenance scripts, excludes environment files from the build context, and mounts durable photo storage. Fresh-checkout type checking generates Next.js route types first.

## Apply locally

From your clean checkout of `cafe-pos`, with `cafe-pos-audit-fixes.patch` downloaded next to it:

```bash
git pull --ff-only origin main
git switch -c codex/audit-fixes
git apply --check ../cafe-pos-audit-fixes.patch
git apply ../cafe-pos-audit-fixes.patch
npm ci
npm run db:migrate
npm run typecheck
npm run lint
npm test
npm run dev
```

Finish any open unsaved carts before updating: legacy drafts had no user/business identity and are not automatically assigned to the new scoped draft keys. The migration must run before the updated login action is used. The patch also contains this document. If main changes before applying, review any patch conflicts instead of forcing the patch.

For uploads on your PC, set `STORAGE_PROVIDER=local` in `.env`. Files are stored in `var/uploads/menu` by default; set `MENU_IMAGE_DIR` to another persistent directory if preferred. Back up this directory along with PostgreSQL. Existing `/public/uploads/menu` assets remain at their previous URLs; keep those files when moving hosts.

For Vercel staging, use a PostgreSQL connection string suitable for pooled/serverless access and set `STORAGE_PROVIDER=s3`, `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_PUBLIC_URL`, and `STORAGE_REGION`. Use `STORAGE_FORCE_PATH_STYLE=true` only when your provider requires it. `STORAGE_PUBLIC_URL` is the public base URL for objects in that bucket, with no `menu/` suffix. Configure public read access to menu objects or a public CDN. Do not put credentials into public environment variables. Local uploads are refused on Vercel; bundled photographs and pasted image URLs still work without upload configuration.

For a Node/VPS live host, choose durable local storage or the same S3 adapter. The supplied Compose setup selects local storage and mounts a named volume. Select `PRINT_PROVIDER=browser` for the browser receipt fallback. The hardware bridge remains a placeholder until the printer model and connection protocol are known.

## Verification and remaining checks

- Production Next.js build: passed.
- Type checking and lint: passed.
- Unit tests: 44 passed.
- Migration and integration suite: 22 passed against a disposable PGlite PostgreSQL engine through the normal `pg` driver. This is not a multi-process PostgreSQL concurrency certification; rerun the integration suite on staging PostgreSQL.
- Automated browser tests were not run: the Chromium download timed out in the execution environment. Check checkout recovery, native dialogs, Select scrolling, image editing/uploading and browser receipt output on the actual iPad before deployment.
- Real S3 credentials, your PC database, Vercel and the live host were not accessed or changed. Upload-provider connectivity and durable-volume backup remain environment checks.

The large menu and purchasing forms can be split further as their features evolve. This patch extracts genuinely shared code and fixes observed defects; it does not rewrite those working forms wholesale. Do not run development seeds on a live database.
