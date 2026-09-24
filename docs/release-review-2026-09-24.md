# Release review — 24 September 2026

Code fixes are in the working tree. Automated database and browser QA has been executed against a disposable local PostgreSQL database. This review supports release readiness; it does not certify that no bugs remain.

| Severity | Finding and reproduction | Fix |
| --- | --- | --- |
| High | Included tax was charged twice: a Rp111,000 price including 11% tax became Rp122,000 before service charge. | POS and server share total calculation; included tax is excluded from net sales and profit and labelled on order details and new receipts. Service charge retains its existing basis: discounted menu prices. |
| High | A saved cart retained old prices while checkout used current prices. Non-cash sales or sufficient cash could silently save a different total from the amount reviewed. | New submissions carry the reviewed total. Checkout rejects a mismatch before writes and refreshes the menu; the cashier must re-add affected items and review again. Existing saved orders retain idempotent retry behavior. Older pending requests remain accepted for recovery. |
| High | Replenishing negative stock used a negative weighting: -10 units at Rp100 plus 20 units at Rp10 produced an average cost of -Rp80. | When existing stock is zero or negative, replenishment starts at the incoming cost. Positive stock still uses the weighted average. |
| Medium | A session switching store elsewhere can cause a POS refresh to change the draft scope without resetting React state. The persistence effect can then save the previous store's cart under the new scope. | POS component identity now includes business and user. Normal catalog refreshes preserve the cart; scope changes remount it before hydration and persistence. Browser regression checks the original saved cart and the new store's empty cart across two tabs. |
| Medium | Receipt totals included service charge without displaying it; browser receipts displayed discounts as positive amounts. | New receipt snapshots include service charge and included-tax status. Both receipt renderers show the breakdown; browser discounts have a minus sign. |
| High | `npm run build` failed immediately on Windows with `"$VERCEL" was unexpected at this time.` | Portable Node build runner replaces Unix shell syntax. |
| High | The old build command continued to Next after failed Vercel migrations, potentially reporting a successful build against an outdated schema. | Build runner exits on migration failure and propagates build failures. Tested using isolated fake CLIs, without running deployment migrations. |
| Medium | Variant availability ignored the business setting allowing negative stock, blocking permitted sales. | Variant stock checks now honor that setting; integration regression verifies the complete catalog. |
| Medium | Menu items with only inactive variants remained selectable but could never pass checkout. Required modifiers with insufficient available choices also led to a dead end. | Hide items with no sellable variants and mark items unavailable when required choices cannot be satisfied. Database regressions cover both cases. |
| Medium | A lost refund/cancellation response left the action button stuck on Working. | Clear pending state in finally, display a recoverable error and permit an idempotent retry. Browser test drops a successful refund response and verifies exactly one stock reversal after retry. |
| Medium | A selected stock-count row with a blank quantity looked like zero in review but was omitted from submission. | Require valid quantities for every selected row before review and submission. Explicit zero remains valid; browser test verifies all three cases. |
| Medium | A rejected stale-price checkout refreshed the page but could reuse the cached old menu, leaving the cashier unable to recover. | Invalidate the menu on catalog-related rejection. Browser test changes the price after adding to cart, proves no order is written on rejection, then completes the sale at the newly reviewed price. |

## Verification

- Unit tests: **222 passed across 28 files** (201 before this review).
- Production build: passed, including TypeScript and generation of all routes.
- `npm run typecheck`: passed.
- ESLint: no errors; one existing unused `totalEntries` warning in the user's modified expenses screen.
- `git diff --check`: passed.
- Database integration: **183 passed across 23 files**, against migrated PostgreSQL, including transaction/idempotency, stock, authorization, tenant isolation, reports and pricing tests.
- Android tablet / Chromium: **21 browser tests passed** against a production build (20-test suite plus the added cross-tab regression). The development-only account switcher is excluded in production.
- iPad landscape / WebKit: **22 browser tests passed**, including the development account switcher and cross-tab regression. This profile uses development mode because production Secure cookies are not retained by WebKit on plain local HTTP.
- Browser coverage includes role-based routing, checkout and double submission, lost checkout/purchase/refund responses, recipe versioning, CSV export and date limits, all owner screens and 11 report types, internal links, runtime errors, CSP, simulated printer success/disconnection, stock counts and cross-tab cart isolation.
- One browser financial scenario verifies Rp111,000 inclusive price, Rp11,100 discount, Rp9,900 included tax, Rp9,990 service, Rp109,890 payable, Rp40,110 change, Rp200 cost and Rp89,800 gross profit against the database and displayed reports.
- Browser harness corrections remove ambiguous dev account/printer selectors and wait for the final login redirect. Integration printer defaults are pinned to mock; dedicated device tests override them.

## Reproduction and environment

The database `cafe_pos_qa_20260924` was created locally, migrated and seeded with fictional data. The ignored `.qa/run.cjs` runner points application, integration and browser processes exclusively at that database. It and downloaded browsers/screenshots remain locally for reproduction. No live database was migrated or seeded.

Local commands used: `npm.cmd test`, `node .qa/run.cjs integration`, `node .qa/run.cjs build`, `npm.cmd run typecheck`, and `npm.cmd run lint`. Browser runs use `node .qa/run.cjs start` on port 3107 and `node .qa/run.cjs e2e --project=android-tablet --workers=1 --grep-invert 'dev role switcher'`; WebKit uses `QA_PORT=3108` with the runner's `dev` and `e2e --project=ipad-landscape --workers=1` tasks. The cross-tab regression was added after the Android full-suite run and passed separately.

The local QA build enables the printer simulator. Rebuild with the intended deployment environment before release; do not deploy these generated QA build artifacts directly.

## Before client handover

1. Smoke-test the actual tablets on the intended HTTPS deployment, including login/session retention. Browser device profiles do not replace physical-device acceptance.
2. Print actual receipts for inclusive/exclusive tax, discounts, service charge, cash change, and reprints. Bluetooth hardware and paper output were simulated, not physically tested.
3. Verify backup restoration and expected peak-load behavior in staging; neither is covered by this run.
4. If this installation already holds real transactions, inspect prior inclusive-tax orders and ingredients replenished from negative stock. These fixes do not rewrite historical charges, profit snapshots, print payloads, or existing average costs.

The pre-existing expenses screen edit was preserved. No deployment or live business-data change was performed during this review. Historical financial data was not repaired.
