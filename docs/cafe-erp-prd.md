# Café Operations ERP / POS

## Product Requirements Document

**Document status:** Implementation-ready draft
**Product type:** Café point-of-sale, recipe inventory, COGS, and profit management system
**Initial deployment:** One café location
**Primary device:** iPad for order entry
**Primary currency:** Indonesian Rupiah (IDR)
**Primary timezone:** Asia/Jakarta
**Working title:** CaféOps

---

## 1. Instructions for Claude Code

Build this product as a production-quality web application, not as a mockup or a collection of disconnected screens.

Follow these rules:

1. Implement the database schema and business rules before building the dashboard.
2. All stock-affecting actions must use database transactions.
3. Inventory must be represented by an append-only movement ledger. Never silently overwrite stock without recording why it changed.
4. Order submission, recipe calculation, stock deduction, profit snapshotting, and print-job creation must be idempotent.
5. Printing must be implemented behind a provider interface so the printer hardware can be changed later without rewriting order logic.
6. Use integer values for money in the smallest currency unit. For IDR, store whole Rupiah as integers. Do not use floating-point values for money.
7. Store ingredient quantities in base units:
   - grams for weight
   - millilitres for volume
   - pieces for countable items
8. Use Asia/Jakarta for the business display timezone, but store timestamps consistently in UTC where appropriate.
9. Do not make the core application dependent on Vercel-only services, Supabase Edge Functions, or proprietary background-job services.
10. Include Docker support, database migrations, seed data, environment documentation, and automated tests from the beginning.
11. Do not add features listed as out of scope unless they are required to make the MVP reliable.
12. If a hardware-specific printing detail is unknown, implement a mock printer and browser fallback, then isolate the hardware adapter behind a clearly documented interface.

The finished application must be deployable:

- locally with Docker or a local Node.js development environment
- on Vercel plus managed PostgreSQL for staging
- on a Linux VPS using Node.js or Docker for production

---

## 2. Product Overview

The system helps a café:

- accept orders from an iPad
- calculate the ingredients used by each order
- deduct ingredients automatically
- calculate product cost and COGS
- calculate gross profit and gross margin
- track purchases, waste, adjustments, and stock levels
- print customer receipts or kitchen/order tickets
- monitor sales, inventory, expenses, and estimated net profit

The first release is a focused café POS and operations system. It is not intended to replace a full accounting platform.

### Core business flow

```text
Staff builds an order on the iPad
        ↓
Staff submits the order
        ↓
System validates menu availability and recipe stock
        ↓
System saves the order and snapshots prices/costs
        ↓
System deducts ingredients through inventory movements
        ↓
System calculates COGS and gross profit
        ↓
System creates a print job
        ↓
Printer integration prints the order ticket or receipt
        ↓
Dashboard and reports update
```

### Critical principle

Stock is deducted when the order is successfully submitted, not when the printer reports success. Printing is an external operation that may fail. A failed print must be retryable without deducting stock a second time.

---

## 3. Goals

### Primary goals

1. Reduce manual inventory calculation.
2. Give café staff a fast and clear iPad ordering experience.
3. Make recipe-level stock deduction reliable.
4. Show realistic COGS and gross profit based on ingredient costs.
5. Provide a clear record of every stock movement.
6. Print orders reliably or clearly report when printing requires attention.
7. Make the system portable to the café's future hosting environment.

### Secondary goals

1. Support menu variations such as small, regular, and large.
2. Support add-ons and modifiers such as extra shot or extra syrup.
3. Track purchases and waste.
4. Support employee roles and permissions.
5. Provide daily, weekly, and monthly reporting.
6. Create a foundation for future multi-location support without implementing multi-location operations in the MVP.

### Non-goals for the MVP

The following are explicitly out of scope for the first release:

- online ordering for customers
- delivery integrations
- loyalty points
- payroll
- employee attendance
- full accounting and tax filing
- payment gateway integration
- automatic bank reconciliation
- supplier marketplace
- multi-branch management UI
- advanced demand forecasting
- kitchen display system
- native iPad App Store distribution
- full offline order submission
- AI forecasting or AI menu recommendations

The architecture may leave room for these features later, but Claude Code should not build them now.

---

## 4. Users and Roles

### Super Admin

The Super Admin is the highest-level system role. This role is intended for the product owner, technical administrator, or implementation team.

Can access:

- every business and location configured in the system
- all POS and order workflows
- all menu, recipe, ingredient, inventory, purchasing, waste, expense, reporting, printer, user, settings, and audit features
- system health and deployment-related settings where implemented

The Super Admin can create, deactivate, or change the role of any user. This role should be used sparingly and must be included in audit logs.

### Owner

The Owner has full access within their café business:

- POS
- orders
- menu
- ingredients
- purchases
- waste
- expenses
- reports
- printer configuration
- staff management
- system settings
- audit logs

The Owner must be able to see and manage every operational area. The Owner should land on the dashboard after login, but can open the POS at any time.

### Manager

Can access operations and reporting:

- POS
- orders
- menu
- ingredients
- purchases
- waste
- expenses
- reports
- printer status

Cannot manage owner accounts or delete historical financial records.

### Cashier

The Cashier is intentionally restricted to the order-facing workflow.

Default access:

- /pos
- the current order/cart
- the submitted-order confirmation screen
- a limited active-order or recent-order view only when required for normal service
- logout

Default permissions:

- orders:create
- orders:read_own
- orders:reprint

The Cashier cannot access:

- dashboard
- sales reports
- COGS reports
- gross profit or net profit
- ingredients
- inventory
- recipes
- menu management
- purchases
- waste
- expenses
- staff management
- printer configuration
- business settings
- audit logs

The Cashier should not see admin navigation items, financial metrics, ingredient costs, stock quantities, or profit information. Hiding navigation is not sufficient: direct route access and API requests must also be denied by server-side authorization.

By default, Cashiers cannot cancel, refund, or void an order after submission. If the café later wants cashier cancellation, expose it as a separate permission that requires a reason and creates an audit record.

### Inventory staff

Can:

- view ingredients
- record purchases
- record waste
- perform stock counts
- submit stock adjustments

Cannot:

- submit customer orders unless separately assigned
- edit financial expenses

### Viewer

Can view dashboards and reports but cannot modify operational data.

### Role access matrix

Use this matrix as the default permission policy:

| Capability | Super Admin | Owner | Manager | Cashier | Inventory Staff | Viewer |
|---|---:|---:|---:|---:|---:|---:|
| POS and create orders | Yes | Yes | Yes | Yes | Optional | No |
| View own submitted order | Yes | Yes | Yes | Optional | Optional | No |
| View all orders | Yes | Yes | Yes | No | No | Read-only |
| Reprint orders | Yes | Yes | Yes | Yes | No | No |
| Cancel/refund orders | Yes | Yes | Permission-based | No by default | No | No |
| Dashboard | Yes | Yes | Yes | No | No | Yes |
| Sales and profit reports | Yes | Yes | Yes | No | Limited if explicitly enabled | Yes |
| Menu management | Yes | Yes | Yes | No | No | No |
| Recipe management | Yes | Yes | Permission-based | No | No | No |
| Ingredient management | Yes | Yes | Yes | No | Yes | Read-only |
| Purchases | Yes | Yes | Yes | No | Yes | No |
| Waste and stock counts | Yes | Yes | Yes | No | Yes | No |
| Expense management | Yes | Yes | Permission-based | No | No | No |
| Staff management | Yes | Yes | No | No | No | No |
| Printer configuration | Yes | Yes | Yes | No | No | No |
| Business settings | Yes | Yes | Permission-based | No | No | No |
| Audit logs | Yes | Yes | Read-only or permission-based | No | No | No |

The application must use an allowlist-based permission model. Do not grant access because a role is merely missing from a deny list.

### Permission rules

Use permission checks on the server, not only by hiding buttons in the UI.

Suggested permission names:

- orders:create
- orders:read_own
- orders:read_all
- orders:cancel
- orders:refund
- orders:reprint
- menu:read
- menu:write
- recipes:write
- inventory:read
- inventory:receive
- inventory:adjust
- inventory:waste
- purchases:write
- expenses:write
- reports:read
- staff:write
- settings:write
- audit:read

---

## 5. Recommended Technical Architecture

### Application stack

- Next.js App Router
- TypeScript
- React
- Tailwind CSS
- shadcn/ui or an equivalent accessible component system
- Zod for request and form validation
- Drizzle ORM or Prisma for PostgreSQL access
- PostgreSQL as the primary database
- Auth.js-compatible session authentication or another portable PostgreSQL-backed authentication layer
- PWA support for iPad installation
- Vitest or an equivalent unit test runner
- Playwright for end-to-end tests
- ESLint and TypeScript strict mode

Use one consistent ORM. Do not mix direct SQL, multiple ORMs, and untracked dashboard-created schema changes.

### Hosting strategy

#### Staging

- Next.js deployed to Vercel
- Managed PostgreSQL through Supabase or another PostgreSQL provider
- Separate staging database
- Separate environment variables

#### Production option A: recommended first production setup

- Next.js application deployed to a client-owned VPS or Node.js-capable hosting
- PostgreSQL kept on managed Supabase or another managed PostgreSQL provider
- Local print bridge or iPad printer integration inside the café

#### Production option B: full client-controlled setup

- Next.js application on a client-owned Linux VPS
- PostgreSQL on the same VPS or a separate private server
- Reverse proxy using Nginx or equivalent
- HTTPS via a valid SSL certificate
- Automated backups
- Monitoring and error logging

### Portability requirements

The codebase must not depend on:

- Vercel-only database access
- Vercel Blob for required application data
- Vercel Cron for essential business logic
- Supabase Edge Functions for core workflows
- in-memory state for orders, stock, print jobs, or sessions
- ephemeral local files for uploaded business assets

If file storage is needed, use an S3-compatible interface or make storage provider configuration explicit.

### Suggested project structure

```text
src/
  app/
    (auth)/
    (dashboard)/
      pos/
      orders/
      menu/
      ingredients/
      inventory/
      purchases/
      waste/
      expenses/
      reports/
      settings/
    api/
      print/
      exports/
  components/
  features/
    auth/
    orders/
    inventory/
    recipes/
    printing/
    reporting/
  lib/
    db/
    auth/
    permissions/
    money/
    units/
    dates/
    validation/
  server/
    services/
    repositories/
    workflows/
  printing/
    printer-provider.ts
    mock-printer.ts
    browser-printer.ts
    providers/
  tests/
drizzle/
  migrations/
scripts/
  seed.ts
  backup/
Dockerfile
docker-compose.yml
.env.example
README.md
```

The exact structure may change, but business logic should remain separate from page components.

### Design direction: Linear/Vercel-inspired minimal SaaS UI

The interface should feel like a calm, premium, modern operations product inspired by Linear, Vercel, Stripe, and high-quality developer tools. It must feel intentional and polished without looking like a generic restaurant template.

The design priorities are:

1. Easy to understand.
2. Fast to operate.
3. Minimal visual noise.
4. Strong hierarchy.
5. Hidden complexity.
6. Clear feedback for operational actions.

The product should feel simple on the surface while keeping the underlying inventory and financial logic powerful.

#### Visual character

- minimal chrome
- generous whitespace
- restrained color usage
- excellent typography
- thin, subtle borders
- calm hierarchy
- small number of visual elements
- almost no decorative gradients
- no excessive shadows
- no heavy glassmorphism
- no oversized dashboard graphics
- no visually noisy restaurant-style UI

#### Theme

Use a light-first theme for the POS and operational screens because the iPad will be used in a bright café environment:

- page background: #F7F8FC
- primary surface: #FFFFFF
- primary text: #0B1220
- secondary text: #667085
- muted text: #98A2B3
- border: #E5E7EB
- selected surface: #F0EEFF
- primary accent: #6C4CF1
- secondary accent: #4E67FF
- success: #12B76A
- warning: #F79009
- danger: #F04438

Use purple or blue sparingly for primary actions, selected states, links, and important system status. Do not turn every card or metric into an accent-colored block.

Dark mode may be added later for admin users, but it must not delay the light-first MVP.

#### Typography

- preferred font: Inter or Geist
- use a compact but readable type scale
- use semibold typography for page titles and key numbers
- use regular typography for descriptions and supporting labels
- use tabular numerals for prices, quantities, percentages, and dashboard metrics
- avoid excessive uppercase labels
- use monospace only for technical metadata, IDs, order numbers, and audit details

#### Spacing and layout

- use an 8px spacing rhythm
- use 24px to 32px page padding on desktop
- use 16px to 24px spacing on iPad layouts where space is constrained
- use a maximum content width of approximately 1200px for desktop admin pages
- use generous section spacing
- keep tables and cards aligned to a clear grid
- avoid cramming multiple unrelated metrics into one row

#### Shape and depth

- use 6px to 10px border radii for controls and cards
- use larger 12px to 16px radii only for major panels or prominent surfaces
- use 1px borders as the primary separation method
- use subtle shadows only for floating elements, dialogs, and menus
- use visible focus rings
- use consistent hover and pressed states

#### Component direction

Prefer:

- left sidebar navigation for admin users
- compact top bar with business, location, user, and connection status
- data tables with clear filters
- command-style search where useful
- simple cards with strong hierarchy
- segmented controls
- tabs
- drawers for editing
- dialogs only when confirmation is necessary
- toast notifications for completed actions
- skeleton loading states
- empty states with one clear next action

Avoid:

- large hero sections inside the admin product
- colorful gradients as decoration
- animated charts that distract from numbers
- dense menus with nested navigation everywhere
- hidden actions without discoverable affordances
- modal chains for ordinary order entry

#### POS-specific direction

The POS should feel like a focused workspace, not an admin dashboard:

- full-height iPad layout
- category navigation at the top or left
- clean menu cards with restrained imagery
- persistent order cart
- clear total and submit action
- high contrast for active states
- no unnecessary charts or financial metrics
- no inventory cost information for cashiers
- clear print status after submission

#### Admin-specific direction

The admin interface should feel closer to Linear or Vercel:

- narrow, calm sidebar
- strong page title and short description
- compact filter row
- structured tables
- subtle status badges
- clear numeric hierarchy
- detailed information in drawers or detail pages
- audit and technical metadata in a compact monospace style

#### Responsive behavior

- the cashier POS is optimized for iPad landscape
- the POS must remain usable at 1024px width
- admin screens should work on desktop and tablet
- tables may become horizontally scrollable on smaller screens
- do not convert every desktop screen into a card stack if a readable table is more useful

#### Accessibility

- meet WCAG AA contrast targets
- do not use color as the only status indicator
- provide text labels or icons with accessible names
- ensure all actions are keyboard accessible on admin screens
- provide visible focus states
- support reduced motion preferences

---

## 6. Functional Requirements

## 6.1 Authentication and staff management

### Requirements

- Staff can log in with email or username and password.
- Passwords must be securely hashed.
- Sessions must be stored securely.
- Staff can log out.
- Owner can invite or create staff users.
- Owner can deactivate staff users.
- Deactivated users cannot log in.
- Every staff-changing action must be audited.
- The system must display the current user and role.

### Acceptance criteria

- A cashier cannot access admin-only pages by manually entering a URL.
- A deactivated user loses access after the next authorization check.
- Server-side permissions are enforced for every mutation.
- Passwords and session tokens are never written to logs.

---

## 6.2 Café and location settings

### Requirements

Create a business settings screen with:

- café name
- logo
- address
- phone number
- tax configuration
- default currency
- timezone
- receipt footer
- order number prefix
- default printer
- default service charge, if used

The initial release supports one location, but records should include an optional location identifier where practical.

### Business settings

- Currency: IDR
- Currency display: Rp25.000
- Timezone: Asia/Jakarta
- Decimal quantities allowed for ingredients
- Money stored as integer Rupiah

---

## 6.3 Menu management

### Requirements

Staff with menu permission can:

- create menu categories
- create menu items
- edit menu items
- archive menu items
- restore archived menu items
- set selling price
- set display order
- set active/inactive status
- add an image
- add an internal description
- configure whether the item is available for POS ordering

### Menu item fields

- name
- category
- description
- image URL or storage key
- base price
- tax behavior
- active status
- display order
- recipe status
- created by
- updated by

An item cannot be sold if it is inactive.

### Variants

Menu items may have variants:

- Small
- Regular
- Large
- Hot
- Iced

Each variant may have:

- name
- price adjustment or fixed price
- separate recipe
- active status

The final order line must snapshot the selected item name, variant name, and selling price. Historical orders must not change when the menu item is edited later.

### Modifiers

Support modifier groups such as:

- sweetness
- milk choice
- extra shot
- extra syrup
- toppings

Each modifier option may have:

- display name
- price adjustment
- optional recipe ingredient impact
- active status

If a modifier adds ingredients, its recipe impact must be included in stock deduction and COGS.

---

## 6.4 Ingredients and units

### Ingredient requirements

Each ingredient must have:

- name
- SKU or internal code
- category
- base unit: gram, millilitre, or piece
- current quantity
- reorder level
- target stock level
- average cost per base unit
- preferred supplier
- active status
- optional notes

### Unit conversion

Purchases may use a different unit than the base unit.

Examples:

- buy coffee beans in kilograms, store in grams
- buy milk in litres, store in millilitres
- buy cups in boxes, store in pieces

Each purchase line must convert the received quantity into the ingredient base unit.

Example:

```text
Purchase: 2 kilograms of coffee beans
Base unit: gram
Received stock: 2,000 grams
```

### Validation

- Quantities must be greater than zero unless recording a negative adjustment.
- Unit conversion values must be greater than zero.
- Ingredients cannot be deleted if historical movements reference them.
- Use archive instead of destructive deletion.

---

## 6.5 Recipe management

Recipes define exactly how much stock an item consumes.

### Recipe structure

A recipe belongs to a sellable menu item variant.

Each recipe line contains:

- ingredient
- quantity in ingredient base unit
- optional waste percentage
- optional notes

Example:

```text
Coffee A, Regular
- Coffee beans: 18g
- Milk: 150ml
- Syrup: 10ml
- Cup: 1 piece
```

### Recipe behavior

- A menu item must show whether it has a complete recipe.
- Staff cannot submit an item with a missing required recipe unless the owner enables a deliberate "no inventory tracking" flag.
- Recipe edits affect future orders only.
- Existing orders retain their recipe and cost snapshot.
- Recipe validation must prevent duplicate ingredient lines in the same recipe.
- If the same ingredient is used by a menu item and a modifier, quantities must be summed before inventory deduction.

### Recipe cost

Recipe COGS is calculated from:

```text
recipe ingredient quantity × ingredient cost per base unit
```

Use the ingredient cost snapshot available at the time the order is submitted.

---

## 6.6 Inventory and stock ledger

Inventory must use an append-only movement model.

### Movement types

- PURCHASE_RECEIPT
- SALE_CONSUMPTION
- WASTE
- MANUAL_ADJUSTMENT_IN
- MANUAL_ADJUSTMENT_OUT
- STOCK_COUNT_CORRECTION
- ORDER_CANCELLATION_REVERSAL
- REFUND_REVERSAL
- OPENING_BALANCE

### Inventory rules

- Every quantity change creates an inventory movement.
- The movement stores the reason and source record.
- Sale consumption is linked to an order and order line.
- Reversal movements link to the original movement where possible.
- Historical movements cannot be edited or deleted.
- Corrections must create a new compensating movement.
- The system must prevent accidental double deduction.
- The system must support negative inventory only if the owner explicitly enables it.

### Stock calculation

Current stock may be calculated as:

```text
opening balance
+ purchase receipts
+ positive adjustments
- recipe consumption
- waste
- negative adjustments
+ cancellation reversals
+ refund reversals
```

For performance, a cached current quantity may exist, but the ledger remains the source of truth and reconciliation must be possible.

### Negative stock behavior

Default behavior:

- If an order would make a tracked ingredient negative, block submission and show the missing quantity.

Optional owner setting:

- Allow negative stock but show a warning and mark the order for inventory review.

### Stock count

Staff can start a stock count:

- select ingredients
- enter counted quantities
- compare system quantity versus physical quantity
- preview adjustments
- submit the count

Submission creates adjustment movements and an audit record.

---

## 6.7 Purchases and supplier receiving

### Requirements

Staff can:

- create suppliers
- create purchase receipts
- add ingredient lines
- enter supplier unit
- enter quantity
- enter conversion to base unit
- enter unit purchase cost
- enter invoice/reference number
- select purchase date
- submit receipt

Submitting a purchase receipt:

1. creates the purchase record
2. creates purchase lines
3. increases ingredient stock
4. updates average cost per base unit
5. creates inventory movements
6. writes an audit log

### Weighted average cost

Use weighted average cost for the MVP.

Example:

```text
Existing stock: 100g at Rp10 per gram
New receipt: 100g at Rp14 per gram
New average cost: Rp12 per gram
```

The exact calculation must use integer-safe arithmetic or a decimal numeric type.

### Purchase immutability

Once a purchase receipt is finalized, it should not be directly edited. Corrections should use a reversal and replacement flow.

---

## 6.8 Waste and spoilage

Staff with permission can record:

- ingredient
- quantity
- reason
- date/time
- notes
- optional photo

Reasons:

- expired
- spilled
- damaged
- preparation waste
- incorrect preparation
- other

Submitting waste:

- decreases stock
- creates a WASTE inventory movement
- records estimated cost
- appears in inventory and profit reporting

---

## 6.9 POS order interface

The POS screen is the most important user interface and must be optimized for an iPad in landscape orientation.

### POS layout

Recommended layout:

- left or top: menu categories
- main area: large menu item cards
- right side: current order cart
- bottom of cart: subtotal, discount, tax/service charge, total
- primary action: submit order

### POS requirements

- touch-friendly controls
- large tap targets
- fast category switching
- search menu
- add item to cart
- select variant
- select modifiers
- change quantity
- add item note
- remove line
- clear cart with confirmation
- optional customer/table number
- order type: dine-in or takeaway
- show stock warning where relevant
- show unavailable items as disabled
- preserve a draft order if the page is refreshed where practical

### Order fields

- order number
- order type: dine-in, takeaway, other
- table number or customer label
- order lines
- discounts
- tax/service charge
- payment method label
- notes
- created by
- created timestamp
- status

Payment processing is out of scope. The MVP may store a payment method label such as cash, card, QRIS, or other for reporting.

### Submission behavior

When staff taps Submit Order:

1. Disable the button immediately to prevent accidental double submission.
2. Generate an idempotency key for the submission.
3. Revalidate menu item availability and current recipes on the server.
4. Revalidate available stock inside the transaction.
5. Create the order.
6. Create order lines with historical price and cost snapshots.
7. Calculate ingredient consumption.
8. Create inventory consumption movements.
9. Calculate subtotal, discount, tax, total, COGS, gross profit, and gross margin.
10. Create one or more print jobs.
11. Commit the database transaction.
12. Return the created order and print status.
13. Clear the cart only after successful submission.

If any required step fails, roll back the transaction and keep the draft order visible.

---

## 6.10 Order lifecycle

### Order statuses

- DRAFT
- SUBMITTED
- PRINT_PENDING
- PRINTED
- COMPLETED
- CANCELLED
- REFUNDED

The exact display status may combine order status and print status, but the underlying values must be explicit.

### Order cancellation

Cancellation requires permission.

When an order is cancelled:

- it remains in the database
- it is never hard-deleted
- a cancellation reason is required
- stock consumption is reversed
- a reversal movement is created
- profit snapshots are marked as excluded from active sales reporting
- the action is audited

### Refund

Refund behavior for the MVP:

- full refund only
- permission required
- reason required
- stock reversal behavior configurable by manager
- original order remains available for audit

Partial refunds may be added later.

### Reprint

Reprinting must:

- create a new print job
- not create another order
- not deduct inventory
- record who requested the reprint
- display whether it was a customer receipt or kitchen ticket

---

## 6.11 Printing architecture

Printing is a combination of application software, local network connectivity, and printer hardware.

### Printer provider interface

Create an interface similar to:

```ts
type PrintJobPayload = {
  orderId: string;
  orderNumber: string;
  locationName: string;
  createdAt: string;
  orderType?: string;
  tableLabel?: string;
  lines: Array<{
    name: string;
    variantName?: string;
    quantity: number;
    modifiers: string[];
    note?: string;
    unitPrice?: number;
    lineTotal?: number;
  }>;
  subtotal?: number;
  discount?: number;
  tax?: number;
  total?: number;
  footer?: string;
};

interface PrinterProvider {
  testConnection(): Promise<PrinterConnectionResult>;
  print(payload: PrintJobPayload): Promise<PrintResult>;
  getStatus(): Promise<PrinterStatus>;
}
```

### Initial printing implementation

Implement these providers:

1. Mock printer provider for automated tests.
2. Browser print fallback for development and basic testing.
3. A local print bridge or hardware-specific adapter once the café provides the exact printer model.

Do not pretend that the browser fallback is automatic thermal printing. Clearly label it as a fallback.

### Print job table

Every print attempt must create or update a print job with:

- order ID
- print destination
- provider
- status
- attempt count
- payload snapshot
- last error
- requested by
- created at
- printed at

Print statuses:

- QUEUED
- PROCESSING
- PRINTED
- FAILED
- CANCELLED

### Printing rules

- A failed print can be retried.
- Retrying a print must not deduct stock again.
- The order screen must show print status.
- Staff must be able to reprint with permission.
- Print payload must be stored as a snapshot so later menu edits do not change old receipts.
- If printing is unavailable, the order must remain saved and visible.

### Hardware decision

Before production hardware integration, obtain:

- exact printer brand
- exact printer model
- connection type
- operating system or bridge device
- whether it supports AirPrint
- whether it supports an official iOS or JavaScript SDK
- receipt width
- whether a cutter is available

---

## 6.12 Dashboard

### Summary cards

For the selected date range, show:

- total sales
- number of orders
- average order value
- COGS
- gross profit
- gross margin
- recorded expenses
- estimated net profit
- cancelled/refunded amount
- waste cost

### Operational widgets

- low-stock ingredients
- out-of-stock ingredients
- top-selling menu items
- highest COGS menu items
- gross profit by item
- recent orders
- failed print jobs
- unusual stock adjustments

### Dashboard formulas

Sales:

```text
active order revenue
excluding cancelled and refunded orders
```

COGS:

```text
sum of order ingredient cost snapshots
for active orders
```

Gross profit:

```text
net sales - COGS
```

Gross margin:

```text
gross profit / net sales × 100
```

Estimated net profit:

```text
gross profit - recorded operating expenses
```

The UI must label this as estimated net profit unless the café has configured all relevant expenses.

---

## 6.13 Expenses

The MVP supports manual operating expense entries.

### Expense fields

- category
- amount
- date
- supplier or payee
- reference number
- notes
- attachment
- recurring flag
- created by

Example categories:

- rent
- salary
- electricity
- water
- internet
- gas
- packaging
- maintenance
- marketing
- delivery
- payment fee
- other

Expenses affect estimated net profit reports but do not alter order COGS.

---

## 6.14 Reports and exports

### Required reports

- sales by day
- sales by menu item
- sales by category
- sales by payment method label
- COGS by menu item
- gross profit by menu item
- gross profit by date
- inventory movement report
- current stock report
- low-stock report
- purchase report
- waste report
- expense report
- estimated net profit report
- cancelled/refunded order report

### Export

Support CSV export for every major report.

Exports must:

- respect the selected date range
- respect user permissions
- use Asia/Jakarta display times
- include clear column names
- not expose passwords, session data, or internal security values

PDF export is optional for the first release and should not block the core MVP.

---

## 6.15 Audit log

Record these events at minimum:

- login
- logout
- user created
- user deactivated
- menu item created/updated/archived
- recipe created/updated
- purchase finalized
- waste recorded
- stock adjusted
- order submitted
- order cancelled
- order refunded
- order reprinted
- expense created/updated
- settings changed

Audit fields:

- actor user ID
- action type
- entity type
- entity ID
- before snapshot where safe
- after snapshot where safe
- metadata
- timestamp
- IP/user-agent where available and appropriate

Audit records must not contain passwords, session tokens, or payment secrets.

---

## 7. Database Design

Use PostgreSQL with migration files committed to the repository.

The names may be adapted to the chosen ORM, but the relationships and business meaning must remain.

### Core tables

#### businesses

- id
- name
- legal_name
- logo_url
- address
- phone
- currency
- timezone
- created_at
- updated_at

#### locations

- id
- business_id
- name
- address
- active
- created_at
- updated_at

#### users

- id
- business_id
- name
- email
- password_hash or external auth identifier
- active
- created_at
- updated_at

#### roles

- id
- name

#### user_roles

- user_id
- role_id

#### suppliers

- id
- business_id
- name
- contact_name
- phone
- email
- address
- active
- created_at
- updated_at

#### menu_categories

- id
- business_id
- name
- display_order
- active
- created_at
- updated_at

#### menu_items

- id
- business_id
- category_id
- name
- description
- image_url
- base_price
- active
- tracks_inventory
- display_order
- created_at
- updated_at

#### menu_item_variants

- id
- menu_item_id
- name
- price
- active
- created_at
- updated_at

#### modifier_groups

- id
- business_id
- name
- required
- min_selections
- max_selections
- active

#### modifier_options

- id
- modifier_group_id
- name
- price_adjustment
- active

#### recipes

- id
- menu_item_variant_id
- version
- active
- created_at
- created_by

#### recipe_lines

- id
- recipe_id
- ingredient_id
- quantity_base_units
- waste_percentage
- notes

#### ingredients

- id
- business_id
- name
- sku
- category
- base_unit
- current_quantity_base_units
- reorder_level_base_units
- target_stock_base_units
- average_cost_per_base_unit
- preferred_supplier_id
- active
- created_at
- updated_at

#### modifier_recipe_lines

- id
- modifier_option_id
- ingredient_id
- quantity_base_units
- waste_percentage

#### purchases

- id
- business_id
- location_id
- supplier_id
- invoice_number
- purchase_date
- status
- total_cost
- created_by
- finalized_at
- created_at

#### purchase_lines

- id
- purchase_id
- ingredient_id
- quantity_purchased
- purchase_unit
- conversion_to_base_units
- quantity_base_units
- total_line_cost
- cost_per_base_unit

#### inventory_movements

- id
- business_id
- location_id
- ingredient_id
- movement_type
- quantity_base_units
- unit_cost
- total_cost
- source_type
- source_id
- related_movement_id
- reason
- notes
- created_by
- created_at

#### stock_counts

- id
- business_id
- location_id
- status
- counted_by
- submitted_at
- created_at

#### stock_count_lines

- id
- stock_count_id
- ingredient_id
- system_quantity
- counted_quantity
- difference_quantity

#### waste_records

- id
- business_id
- location_id
- ingredient_id
- quantity_base_units
- reason
- estimated_cost
- notes
- created_by
- created_at

#### orders

- id
- business_id
- location_id
- order_number
- status
- order_type
- table_label
- subtotal
- discount_total
- tax_total
- service_charge_total
- total
- cogs_total
- gross_profit
- gross_margin_percentage
- payment_method_label
- notes
- idempotency_key
- created_by
- created_at
- cancelled_at
- cancelled_by
- cancellation_reason

#### order_lines

- id
- order_id
- menu_item_id
- menu_item_variant_id
- item_name_snapshot
- variant_name_snapshot
- quantity
- unit_price_snapshot
- line_total
- cogs_snapshot
- gross_profit_snapshot
- notes

#### order_line_modifiers

- id
- order_line_id
- modifier_option_id
- modifier_name_snapshot
- price_adjustment_snapshot
- cogs_adjustment_snapshot

#### order_ingredient_consumption

- id
- order_id
- order_line_id
- ingredient_id
- quantity_base_units
- unit_cost_snapshot
- total_cost
- inventory_movement_id

This table provides an explicit audit trail of the recipe calculation used by an order.

#### print_jobs

- id
- order_id
- destination
- provider
- status
- attempt_count
- payload_snapshot
- last_error
- requested_by
- created_at
- processed_at
- printed_at

#### expenses

- id
- business_id
- location_id
- category
- amount
- expense_date
- payee
- reference_number
- notes
- attachment_url
- recurring
- created_by
- created_at
- updated_at

#### audit_logs

- id
- business_id
- actor_user_id
- action
- entity_type
- entity_id
- metadata
- created_at

### Database constraints

Implement:

- foreign keys
- unique order number per business/location where appropriate
- unique idempotency key per business/user session or per order submission context
- non-negative constraints where business rules require them
- check constraints for supported units and statuses where practical
- indexes for order date, inventory ingredient/date, print status, and report filters

---

## 8. Transaction and Idempotency Requirements

### Order submission transaction

Order submission must execute inside one database transaction:

1. Lock or safely re-read relevant ingredient rows.
2. Validate active menu item and recipe.
3. Calculate all ingredient consumption.
4. Validate stock.
5. Insert order.
6. Insert order lines and snapshots.
7. Insert consumption rows.
8. Insert inventory movements.
9. Update cached ingredient quantities if used.
10. Insert print jobs.
11. Insert audit log.
12. Commit.

If any operation fails, the complete transaction must roll back.

### Double-submission prevention

The same idempotency key must return the original order result instead of creating a second order.

Cover:

- double tap
- iPad browser retry
- network retry
- page refresh after submit
- API retry from a print bridge

### Cancellation transaction

Cancellation must:

1. lock the order
2. verify it is cancellable
3. create reversal consumption records
4. create reversal inventory movements
5. update order status
6. update active report inclusion
7. write audit log
8. commit

Cancellation must also be idempotent.

---

## 9. API and Server Actions

Use server-side actions or route handlers consistently. Do not expose privileged database credentials to the browser.

### Suggested endpoints or actions

#### Authentication

- login
- logout
- current user
- create staff
- deactivate staff

#### Menu

- list menu
- create category
- create menu item
- update menu item
- archive menu item
- create variant
- update recipe
- update modifiers

#### POS and orders

- create draft
- submit order
- get order
- list orders
- cancel order
- refund order
- reprint order

#### Inventory

- list ingredients
- create ingredient
- update ingredient
- list inventory movements
- create stock adjustment
- create stock count
- submit stock count

#### Purchasing

- list suppliers
- create supplier
- create purchase
- finalize purchase

#### Waste

- create waste record
- list waste records

#### Reports

- sales summary
- item performance
- profit summary
- current stock
- inventory movements
- expense summary
- CSV exports

#### Printing

- create print job
- get print job status
- retry print job
- test printer connection

Every mutation must validate:

- authentication
- permission
- business/location ownership
- input schema
- business state

---

## 10. User Interface Requirements

### Role-aware navigation and screen access

The UI must render different navigation and landing experiences based on the authenticated role.

#### Super Admin and Owner

- see the complete sidebar
- land on the dashboard after login
- can switch to POS from the sidebar
- can access all operational, financial, settings, and audit screens allowed by their scope

#### Manager

- see the operational sidebar
- land on the dashboard
- can access POS, orders, inventory, purchasing, waste, expenses, reports, and printer status
- must not see owner-only staff controls unless explicitly permitted

#### Cashier

- land directly on the POS screen after login
- see only POS-related navigation
- see no dashboard, profit, COGS, inventory, menu administration, purchasing, expense, staff, or settings links
- see only the order information needed to perform the current service workflow
- return to the POS after successful order submission
- see a clear submitted-order and print-status confirmation
- receive a permission error or redirect if attempting to open an admin route

The backend must enforce the same rules. The UI must never be treated as the security boundary.

### General

- responsive from 1024px iPad width upward
- desktop admin layouts supported
- touch-friendly controls
- visible loading states
- visible success and error states
- no silent failures
- keyboard support for admin screens
- accessible color contrast
- confirmation for destructive actions
- clear empty states
- clear offline or disconnected state

### POS design principles

- staff should be able to add common items with one tap
- cart should remain visible
- avoid unnecessary modal steps
- use large buttons
- avoid tiny table controls
- preserve the order if an optional dialog is closed
- show the final total before submission
- show a clear submitted confirmation with order number
- show print status without blocking the saved order

### Required pages

#### /login

- login form
- validation
- loading state
- error state

#### /pos

- menu categories
- product grid
- cart
- modifiers
- order notes
- total
- submit order

#### /orders

- date filter
- status filter
- order number search
- order list
- print status
- view/reprint/cancel actions

#### /orders/[id]

- order details
- item snapshots
- COGS
- gross profit
- inventory consumption
- print jobs
- audit history

#### /menu

- categories
- menu items
- variants
- availability

#### /menu/[id]/recipe

- recipe lines
- base units
- current ingredient cost
- calculated item cost
- margin preview

#### /ingredients

- ingredient list
- current stock
- unit
- average cost
- reorder status

#### /inventory

- movement ledger
- stock count
- stock adjustments
- low stock

#### /purchases

- suppliers
- purchase receipts
- finalize receipt

#### /waste

- record waste
- history

#### /expenses

- expense entry
- history

#### /reports

- sales
- COGS
- gross profit
- estimated net profit
- inventory
- waste
- exports

#### /settings

- business details
- users and roles
- printer configuration
- tax/service charge
- inventory behavior

---

## 11. Calculations

### Order totals

```text
subtotal = sum(order line totals)
discount total = discounts applied
tax total = configured tax calculation
service charge total = configured service charge
total = subtotal - discount total + tax total + service charge total
```

### Line total

```text
line total =
(base unit price + variant adjustment + modifier price adjustments) × quantity
```

### COGS

```text
line COGS =
sum(recipe quantity × ingredient cost snapshot)
× quantity ordered
```

### Gross profit

```text
gross profit = net sales - COGS
```

For the MVP, define net sales clearly in the settings and report labels. The default should be the sale total after discounts, with tax treatment configurable.

### Gross margin

```text
gross margin = gross profit / net sales × 100
```

If net sales is zero, show an em dash instead of dividing by zero.

### Estimated net profit

```text
estimated net profit = gross profit - recorded operating expenses
```

The UI must not imply that this is audited accounting profit.

---

## 12. Security Requirements

- Use secure password hashing.
- Use secure, HTTP-only session cookies.
- Use CSRF protection where applicable.
- Validate every input with Zod or equivalent.
- Enforce authorization on the server.
- Scope all queries by business ID and location where relevant.
- Never trust business ID, user ID, role, or price values supplied by the browser.
- Recalculate order prices and COGS on the server.
- Use parameterized queries through the ORM.
- Do not expose database service-role keys to the client.
- Do not log passwords, tokens, private keys, or full sensitive payloads.
- Rate-limit login and sensitive mutation endpoints.
- Record security-relevant audit events.
- Use HTTPS in staging and production.
- Add backup and restore documentation.

---

## 13. Offline and Network Behavior

### MVP behavior

The MVP may require an active internet connection for submitting orders, but it must behave safely when connectivity fails.

When offline or disconnected:

- show a prominent connection status
- keep the current unsaved cart in local browser storage where practical
- do not show a false successful submission
- do not deduct inventory locally without server confirmation
- allow staff to retry
- show the last known printer status

### Future offline phase

Full offline order submission requires:

- local queue
- locally cached menu and recipes
- locally generated order identifiers
- conflict resolution
- secure synchronization
- local print coordination

Do not implement this in the first release unless specifically approved.

---

## 14. Deployment and Environment Requirements

### Environment variables

Create a documented environment file containing placeholders for:

- DATABASE_URL
- AUTH_SECRET
- APP_URL
- BUSINESS_TIMEZONE
- STORAGE_ENDPOINT
- STORAGE_BUCKET
- STORAGE_ACCESS_KEY
- STORAGE_SECRET_KEY
- PRINT_PROVIDER
- PRINT_BRIDGE_URL
- PRINT_BRIDGE_SECRET
- SENTRY_DSN or equivalent optional error monitoring

Never commit real secrets.

### Docker

Provide:

- Dockerfile for the application
- docker-compose configuration for local PostgreSQL
- healthcheck endpoint
- production start command
- database migration command
- seed command

### Production requirements

- HTTPS
- reverse proxy
- process restart policy
- database backups
- log rotation
- monitoring
- error reporting
- documented restore procedure
- staging environment separate from production

### Migration readiness

The application must support:

- running migrations on a new PostgreSQL database
- seeding initial administrator and sample menu data
- exporting CSV data
- importing initial ingredients, menu items, and recipes
- switching database connection through environment variables
- deploying the same build to Vercel or a Linux VPS

---

## 15. Testing Requirements

### Unit tests

Test:

- money calculations
- tax and discount calculations
- recipe COGS
- weighted average cost
- unit conversions
- gross profit
- gross margin
- net profit estimate
- stock deduction
- stock reversal
- idempotency behavior
- permission checks
- role-to-permission matrix
- business and location scoping

### Database/integration tests

Test:

- purchase receipt increases stock
- order submission consumes recipe ingredients
- insufficient stock blocks submission
- order cancellation reverses stock
- reprint does not affect stock
- failed print does not roll back a valid order
- duplicate submission returns the existing order
- historical order snapshots remain unchanged after menu edits
- stock count creates the correct adjustment movements
- cashier cannot query or mutate admin resources
- owner can access all café resources
- manager access follows the configured permission policy

### End-to-end tests

At minimum:

1. Owner creates an ingredient.
2. Owner creates a menu item and recipe.
3. Staff submits an order.
4. System deducts ingredients.
5. System calculates COGS and gross profit.
6. System creates a print job.
7. Mock printer reports success.
8. Dashboard reflects the sale.
9. Staff cancels the order.
10. System reverses inventory.
11. Dashboard excludes the cancelled order.

### Hardware test checklist

Once the exact printer is available:

- connection test
- normal order print
- long order print
- special characters
- Indonesian currency formatting
- multiple modifiers
- order notes
- reprint
- printer offline
- paper out
- cutter behavior
- duplicate retry

---

## 16. Seed Data

Provide seed data for local development:

### Ingredients

- Coffee beans, gram
- Fresh milk, millilitre
- Syrup, millilitre
- Ice, gram
- Paper cup, piece
- Cup lid, piece

### Menu

#### Coffee A

- Regular price: Rp25,000
- Coffee beans: 18g
- Fresh milk: 150ml
- Syrup: 10ml
- Paper cup: 1 piece
- Cup lid: 1 piece

#### Coffee B

- Regular price: Rp30,000
- Coffee beans: 20g
- Fresh milk: 180ml
- Syrup: 15ml
- Paper cup: 1 piece
- Cup lid: 1 piece

Use clearly fictional sample data and mark it as development data.

---

## 17. MVP Acceptance Criteria

The MVP is ready for pilot testing only when all criteria below pass.

### POS

- Staff can log in.
- Staff can open POS on an iPad.
- Staff can select menu items and variants.
- Staff can select modifiers.
- Staff can review the cart.
- Staff can submit an order.
- A duplicate tap does not create a duplicate order.
- The submitted order receives a unique order number.

### Inventory

- Each sellable menu variant has a recipe.
- The system converts recipe quantities into base units.
- The system deducts all recipe ingredients on successful order submission.
- Insufficient stock is handled according to the configured rule.
- Every deduction appears in the inventory ledger.
- Cancelled orders create reversal movements.
- Reprints do not affect stock.

### Financial calculations

- Order line prices are snapshotted.
- Ingredient cost snapshots are stored.
- COGS is visible per order.
- Gross profit is visible per order.
- Gross margin is calculated safely.
- Dashboard totals match the underlying order data.
- Expenses affect estimated net profit but not COGS.

### Printing

- A print job is created for every submitted order.
- A mock printer can process the print job.
- A failed print is visible.
- A failed print can be retried.
- Retrying does not create a new order or deduct stock again.
- A hardware-specific provider can be added without changing order workflows.

### Administration

- Owner can manage staff.
- Owner can manage menu items.
- Owner can manage recipes.
- Authorized staff can record purchases, waste, and adjustments.
- Unauthorized staff cannot access protected mutations.
- Audit records are created for critical actions.

### Role-based access

- Super Admin can access all businesses, locations, and system features.
- Owner can access the complete café system within their business.
- Manager can access operational and reporting features permitted by the policy.
- Cashier lands on the POS and cannot see or access admin, inventory, financial, or settings screens.
- Cashier cannot access restricted routes by typing the URL directly.
- Cashier cannot call restricted server actions or API routes.
- Cashier cannot see ingredient costs, stock quantities, COGS, gross profit, or net profit.
- A permission change takes effect on the next authorization check.

### Design quality

- The POS feels focused and fast on a 1024px iPad.
- Admin pages use a restrained Linear/Vercel-inspired visual system.
- Light-first colors, typography, spacing, borders, and radii use shared design tokens.
- Loading, empty, success, error, offline, and print-failure states are designed rather than left as browser defaults.
- No major screen looks like an unstyled CRUD scaffold.

### Deployment

- Local setup is documented.
- Staging deployment is documented.
- Production VPS deployment is documented.
- Database migrations are committed.
- Environment variables are documented.
- Backup and restore steps are documented.

---

## 18. Phased Implementation Plan

### Phase 0: Foundation

- initialize repository
- configure Next.js and TypeScript
- configure linting and formatting
- configure PostgreSQL
- configure ORM
- create migration workflow
- create Dockerfile and local Docker Compose
- create authentication foundation
- create authorization helpers
- create test setup
- create seed data

### Phase 1: Menu and ingredients

- businesses and locations
- categories
- menu items
- variants
- ingredients
- units
- recipes
- recipe cost preview

### Phase 2: Inventory

- inventory movements
- purchases
- weighted average costs
- waste records
- stock adjustments
- stock counts
- low-stock warnings

### Phase 3: POS and order workflow

- iPad POS layout
- cart
- modifiers
- order submission
- idempotency
- stock deduction transaction
- order snapshots
- cancellation and reversal

### Phase 4: Printing

- print job model
- mock provider
- browser fallback
- print status UI
- retry and reprint
- hardware provider after printer model is confirmed

### Phase 5: Dashboard and reports

- sales dashboard
- COGS
- gross profit
- expenses
- estimated net profit
- inventory reports
- CSV exports

### Phase 6: Hardening and pilot

- end-to-end testing
- permission audit
- transaction/concurrency testing
- printer testing
- backup and restore test
- deployment to staging
- staff acceptance testing
- production deployment

Do not begin Phase 5 before the transaction and inventory tests in Phases 2 and 3 are passing.

---

## 19. Pilot Testing Checklist

Before the café uses the application for real orders:

- confirm printer model and connection
- confirm iPad browser or app approach
- load the real menu
- load real recipes
- verify ingredient units
- verify ingredient opening stock
- verify ingredient costs
- test one order per menu item
- compare calculated COGS with manual calculation
- test cancellation
- test reprint
- unplug printer and retry
- disconnect internet and confirm safe failure state
- test staff roles
- test backup restore
- train staff on order submission and cancellation

Run the system in parallel with the existing process for a short pilot period before making it the only order system.

---

## 20. Open Decisions Required Before Hardware Integration

The following decisions are intentionally left open until the café provides the information:

1. Exact thermal printer brand and model.
2. Customer receipt, kitchen ticket, or both.
3. AirPrint, network printing, Bluetooth, USB, or local print bridge.
4. Whether orders are dine-in, takeaway, or both.
5. Whether tax is included in menu prices.
6. Whether service charge is used.
7. Whether negative inventory is allowed.
8. Whether inventory is tracked by one location or multiple locations later.
9. Whether staff use individual accounts or shared cashier accounts.
10. Whether the café needs a customer-facing receipt or only an internal order ticket.
11. Whether payment method is only recorded or later integrated with a payment provider.

Until these are confirmed, implement configuration points and mock providers instead of hardcoding assumptions.

---

## 21. Definition of Done

The project is considered complete for the first pilot when:

- all MVP acceptance criteria pass
- all critical automated tests pass
- the real printer works in a café-like environment
- stock deductions reconcile with manual calculations
- cancellation and reprint behavior has been tested
- staff permissions have been verified
- production backups have been tested
- the application can be deployed from the repository to a fresh environment
- the café owner can operate the core workflow without developer assistance

The first release should favor correctness, auditability, and reliable order handling over a large number of optional features.
