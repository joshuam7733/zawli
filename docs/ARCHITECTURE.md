# Architecture

## Stack

| Concern    | Choice                                                                 | Why                                                                |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Framework  | **Next.js 16** (App Router, React 19, Turbopack) + TypeScript 5.9      | One deployable for UI, server actions and APIs                     |
| Styling    | Tailwind CSS 4, small in-house component kit (`src/components/ui.tsx`) | No heavy UI dependency; consistent tokens                          |
| Database   | **PostgreSQL** (17/18)                                                 | Relational integrity, composite FKs, partial unique indexes        |
| ORM        | **Prisma 7** (`prisma-client` generator, `@prisma/adapter-pg`)         | Typed queries, migrations                                          |
| Validation | Zod 4                                                                  | Every service input is parsed server-side                          |
| Auth       | **Better Auth** (email + password, DB sessions)                        | Maintained, framework-native, scrypt hashing, rate-limited sign-in |
| Real-time  | Server-Sent Events + polling fallback, backed by a DB change feed      | Works through most proxies; DB stays the source of truth           |
| QR codes   | `qrcode`                                                               | SVG/PNG generation server-side                                     |
| Tests      | Vitest (unit, integration, security) + Playwright (E2E)                |                                                                    |
| Local DB   | `embedded-postgres` (no Docker) or Docker Compose                      |                                                                    |

## Source layout

```
prisma/                 schema.prisma, migrations/, seed.ts
src/domain/             PURE business rules (no I/O): money, pricing, cart validation,
                        order/ticket/subscription state machines, permissions, ticket text
src/server/             server-only code
  db.ts                 Prisma client          auth.ts      Better Auth config
  authz.ts              tenant/branch/platform authorization (the security boundary)
  session.ts            request → user/tenant context for pages and actions
  api.ts / action.ts    error mapping, CSRF origin check, rate limits, form results
  events.ts             branch change feed + in-process wake-up signal
  services/*.ts         ALL business operations (take an authorized context)
src/app/                routes: /t (customers), /app/[tenant] (restaurant), /admin (platform), /api
src/components/         UI kit, brand, live-board hook
tests/unit|integration  Vitest suites       e2e/   Playwright
```

**Rule:** routes, server actions and API handlers are thin. They resolve a context (`getTenantContext`, `apiTenantContext`, `getSessionUser`) and call a service. Services do validation (Zod), authorization (`requirePermission`), tenant scoping and transactions. Tests call services directly with real contexts.

## Multi-tenancy

One application, one database, a `tenantId` on every tenant-owned row. Isolation is enforced in three layers:

1. **Database** — child rows reference parents through _composite_ foreign keys `(tenantId, parentId) → parent(tenantId, id)`. Postgres rejects a table that points at another tenant's branch, an item in another tenant's category, a ticket for another tenant's order, etc. (tested in `tenant-isolation.test.ts → database-level guarantees`).
2. **Services** — every query includes `tenantId: ctx.tenant.id`; ids from the client are looked up _within the tenant_ and a miss is reported as **NOT_FOUND** (no existence leak).
3. **Authorization** — `loadTenantContext` only succeeds for an active membership; permissions are checked per tenant or per branch (`src/server/authz.ts`, matrix in `src/domain/permissions.ts`).

Hiding UI controls is cosmetic only.

### Roles and branch scope

- Platform: `SUPER_ADMIN`, `PLATFORM_BILLING`, `PLATFORM_SUPPORT` (read-only). Restaurant staff have no platform role.
- Tenant: `RESTAURANT_OWNER`, `MANAGER`, `WAITER`, `KITCHEN`.
- A `Membership` with `allBranches = true` applies its role at every branch. Otherwise `StaffBranchAssignment` rows grant a role **per branch** (someone can be MANAGER at one branch and WAITER at another).
- Tenant-wide permissions (settings, billing, staff, menu, branches) need a tenant-wide membership; branch permissions use the role at that branch.
- In PRINTER and MANUAL fulfilment modes there may be no kitchen screen, so waiters may also progress kitchen tickets there.

## Customer ordering

```
QR scan → /t/<token> → resolveQr(token)
  token ACTIVE? table active? branch active? tenant ACTIVE?  (else friendly page)
→ public menu for that branch (archived/not-offered items hidden, sold-out shown)
→ cart (browser localStorage, per table)  → POST /api/public/orders
   { token, idempotencyKey (UUID kept until success), lines: [{menuItemId, variantId, optionIds, quantity, note}] }
→ placeOrder():  one transaction
   lock table row → load live menu → validate every line (domain/cart.ts)
   → compute totals (domain/pricing.ts) → open/reuse table session → order number
   → Order + OrderItem snapshots + modifiers → KitchenTicket per station → PrintJobs
   → status history (CUSTOMER) → BranchEvent
→ /t/<token>/orders/<publicToken>  (polls every 8 s)
```

- **Prices never come from the browser.** The request schema has no price fields; everything is recomputed.
- **Idempotency:** `(tenantId, idempotencyKey)` is unique. A retry or a concurrent double-tap returns the original order (`duplicate: true`).
- **Snapshots:** item name, variant, category, allergens, unit price, modifier names and prices are copied onto the order. Menu edits never change old orders.
- **Unavailable items:** the whole order is rejected with a readable message per problem; the client refreshes the menu.

### Table sessions

- One `OPEN` session per table (partial unique index). Every order and waiter call joins the open session; several guests/devices can order independently into it.
- A session is **reused** while `lastActivityAt` is within the tenant's idle limit (default 180 min). Otherwise it is marked `EXPIRED` and a new one opens — stale sessions are never treated as permanently active.
- Staff **close** a session ("Free the table") after paying; deactivating a table closes it too.
- Concurrent first orders at an empty table are serialized by a row lock on the table.

### Pricing rules

1. subtotal = Σ (unit price + modifier deltas) × quantity
2. service charge = subtotal × rate (if enabled)
3. tax base = subtotal + service charge
4. inclusive tax: reported portion = base × r / (1 + r), total unchanged; exclusive tax: base × r added
5. each percentage rounded half-up to the currency's minor unit, once per order.

Tax is **off by default**. Zawli makes no assumption about any country's tax rules; restaurants enable it with the rate and treatment they have confirmed.

## Orders and the kitchen

State machine (`src/domain/order-status.ts`):

```
PLACED → ACKNOWLEDGED → PREPARING → READY → (OUT_FOR_DELIVERY) → SERVED → COMPLETED
   └──────────┴─────────────┴─────────┴──→ CANCELLED (manager/owner, with reason, unpaid only)
```

- Kitchen work happens on **tickets** (one per order per station, unique). Ticket states: PLACED → ACKNOWLEDGED → PREPARING → READY, one step at a time.
- The order's kitchen status is **derived** from its tickets (all ready → READY; any started → PREPARING; …) and only ever moves forward. Each order transition writes `OrderStatusHistory` with actor, from, to, reason.
- Transitions use optimistic concurrency (`updateMany … where status = from`). Repeating an already-applied ticket transition is a no-op, so retries after a dropped connection are safe.
- Routing: item rule → category rule → branch default station.
- `COMPLETED` happens automatically when an order is both SERVED and fully PAID (whichever comes last), or manually once paid.

## Real-time updates

- Every change writes a `BranchEvent` row (monotonic id) in the same transaction.
- `GET /api/app/<slug>/events?branch=…` is an SSE stream: it sends `change` events with ids after the client's cursor (`Last-Event-ID` on reconnect), checking the DB at least every 15 s and immediately when the in-process signal fires. Streams end after 10 minutes and the browser reconnects automatically; membership is re-checked every minute.
- Clients **refetch the board** on each change; they also poll every 15 s if SSE fails and refetch on reconnect, focus and `online`. Missed events are therefore always reconciled from the database.
- Multi-instance deployments work without changes (DB polling); for lower latency across instances, replace `signalBranch` with Postgres `LISTEN/NOTIFY` or Redis pub/sub.

## Kitchen fulfilment modes (per branch)

| Mode                  | Behaviour                                                                              |
| --------------------- | -------------------------------------------------------------------------------------- |
| `DIGITAL_DISPLAY`     | Tickets on `/app/<slug>/kitchen`                                                       |
| `PRINTER`             | Tickets queued as print jobs; floor staff progress orders from the order/kitchen queue |
| `DIGITAL_AND_PRINTER` | Both                                                                                   |
| `MANUAL`              | Simple queue (kitchen/orders screens) printed or passed on by hand                     |

### Printing

- A `PrintJob` row exists per (ticket, printer) — unique. Retries and reprints update that row; they never create a second order or ticket.
- **Browser printing (works today):** `/app/<slug>/print/ticket/<id>` renders a monospace ticket sized for 58 mm / 80 mm thermal paper or A4 with `@page` rules. The print queue lets staff open, confirm, fail or retry jobs. Browsers always show a print dialog — silent printing is **not** possible from a web page.
- **Print bridge (contract only):** a helper on the kitchen computer polls `GET /api/print-bridge/jobs` with `Authorization: Bearer zpb_…` (key shown once when the printer is created, stored hashed), prints the plain-text ticket (`domain/ticket-format.ts`) via ESC/POS, then `POST /api/print-bridge/ack { jobId, ok, error }`. After 5 failed attempts a job becomes FAILED. **The helper application itself is not built yet** (see ROADMAP).

## Pay first with mobile money (MTN MoMo, Airtel Money)

Stops guests ordering and walking away. Per restaurant (Restaurant settings → Mobile money payments):

- **Payment rule:** "before the kitchen starts" (default) or "at the restaurant". Pay-first takes effect only once MTN MoMo or Airtel Money is turned on; until then orders flow as before.
- **Flow:** guest orders → order is `PENDING_PAYMENT` (no kitchen tickets, no printing, invisible on the kitchen screen) → guest picks MTN or Airtel and enters their number → the provider pushes a PIN prompt → Zawli asks the provider for the status → on success a `PaymentRecord` (source `PROVIDER`) is written and the order is released to the kitchen (`PLACED`, tickets + print jobs) in the same transaction.
- **Unpaid orders** are cancelled after the restaurant's time limit (default 15 min; never while a PIN prompt is still being answered). Money arriving after cancellation is not applied; staff get a "refund needed" notification and an audit entry.
- **Trust:** provider callbacks (`/api/public/payments/callback`) are never trusted — they only trigger a status check against the provider. Polling (guest page every 3 s, sweeper every 20 s in `src/instrumentation.ts`, optional `/api/cron/payments`) covers missed callbacks.
- **Providers:** `src/server/mobile-money/` — MTN MoMo Collections (RequestToPay; sandbox uses EUR and target `sandbox`), Airtel Africa Open API (Collections; `TS`/`TF`/`TIP`/`TA` statuses), and a **simulator** for development/demos (number ending `000` = declined, `999` = never answered, anything else approves after ~5 s). The simulator is refused in production except for demo restaurants.
- **Money goes to each restaurant's own MTN/Airtel merchant account** (their API keys); Zawli never holds funds. Keys are AES-256-GCM encrypted (`PAYMENT_SECRETS_KEY`), write-only in the UI, and never logged.
- Staff can still record a payment by hand (e.g. the guest's phone has no balance and they pay another way); a full payment releases the order to the kitchen too.
- Going live needs each restaurant's own MTN MoMo (Collections) and/or Airtel Money merchant API access from the provider. Some Airtel accounts require request signing (`x-signature`) — not implemented; check with Airtel.

## Payments (pay at the restaurant, V1)

- No online gateway. Staff record what they received: cash, mobile money paid in person, card/POS, other.
- Partial and split payments are allowed (several records per order, different methods). Overpayment is rejected; for cash, staff can enter the amount tendered to see change, but only the applied amount is recorded.
- Concurrency: payments lock the order row; a double-submitted form (same idempotency key) records once.
- Voiding (manager/owner) keeps the record with reason and actor; refunds happen outside Zawli.
- Mobile-money references are stored as typed; **they are not verified** with any provider.
- A future gateway implements the same `recordPayment` path (provider webhook → `PaymentRecord` with a provider reference).

## SaaS billing (manual, V1)

- `SubscriptionPlan` → `Subscription` (one per tenant) with `SubscriptionEvent` history.
- States: TRIAL → ACTIVE ⇄ PAST_DUE → SUSPENDED → ACTIVE; CANCELLED → ACTIVE (reactivation). Rules in `src/domain/billing.ts`.
- SUSPENDED/CANCELLED subscriptions put the tenant in **SUSPENDED**: staff can sign in, view and export data; changes and customer ordering stop. Data is never deleted.
- Invoices: `INV-YYYY-NNNNN` (atomic counter), DRAFT → ISSUED → PARTIALLY_PAID → PAID, or VOID (no payments). Payments recorded manually. Overdue = issued/part-paid past due date.
- "Run billing check" (or a scheduler calling `runBillingSweep`) moves overdue/expired-trial subscriptions to PAST_DUE. It never suspends automatically.
- Separate from restaurant order payments (`PaymentRecord`) by design.

## Tenant lifecycle

`ONBOARDING` (configurable, no public orders) → `ACTIVE` (requires the readiness checklist: branch, default station, owner who completed setup, available menu item, table with QR, subscription in good standing) → `SUSPENDED` ⇄ `ACTIVE` → `DEACTIVATED` (no access; data retained).

## Localization

Per tenant: currency (ISO 4217, minor units from `Intl`), timezone (IANA, overridable per branch), locale (BCP 47). All money/time formatting goes through `src/lib/format.ts`. UI copy is English; strings are kept in components today — extracting them into message catalogues is on the roadmap.
