# Zawli — project state

_Last updated: 2026-10-21. A snapshot for whoever picks this up next (human or agent). Read this first, then [AGENTS.md](AGENTS.md)._

---

## 1. Where to resume (read this first)

**State right now:** all 11 phases of the master build prompt, plus the pay-first mobile money feature (MTN MoMo + Airtel Money), are built and tested on this computer. Nothing has been deployed or committed, and Git isn't installed yet.

**To pick up where we left off:**

1. Double-click **`Start Zawli.cmd`** (or **`Rebuild and Start Zawli.cmd`** after code changes). Two windows open, "Zawli database" and "Zawli app", and the browser opens at `http://localhost:3000`.
2. Follow **[TESTING.md](TESTING.md)**: demo accounts, scanning table QR codes from a phone on the same Wi-Fi, and simulator phone numbers.
3. Then choose the next step with the user. The order we recommend:
   1. **Test on a real phone**: scan a table QR, order, pay with the simulator, watch the kitchen screen. This hasn't been checked on a physical phone yet.
   2. **Decide what to do with `e2e/staff.spec.ts` and `e2e/helpers.ts`.** They were last edited on 2026-10-21 at 1:24 PM, probably by another session, and nobody has confirmed they pass. Run them with `E2E_BASE_URL=http://localhost:3000 npx playwright test e2e/staff.spec.ts` against a running, seeded app, then finish them or delete them.
   3. **Install Git**, run `git init`, and make the first commit. `.gitignore` is already set up.
   4. **Go live** using [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). This needs explicit approval from the user: a VPS, a domain and live MTN/Airtel keys all cost money or are outward-facing.
   5. Pick items from the "What remains" list (§4).

**Standing user preference:** keep scope minimal. Add only what was asked and leave everything else exactly as it is. Payments are **mobile money only, MTN and Airtel only**. No cards, no other providers, no table codes or geofencing unless the user asks for them.

---

## 2. Architecture

### Stack

| Layer      | Choice                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Web app    | Next.js 16.4.2 (App Router, Turbopack), React 19.3.1, TypeScript strict, Tailwind                                             |
| Database   | PostgreSQL. Locally via `embedded-postgres` (port 54329, data in `.pg-data`); in production postgres:17 in Docker            |
| ORM        | Prisma 7.10.1, `prisma-client` generator → `src/generated/prisma`, `@prisma/adapter-pg`, `prisma.config.ts`                   |
| Auth       | Better Auth 1.7.11: email + password, public sign-up disabled, 12 h sessions, cookie prefix `zawli`, one-time setup links    |
| Validation | Zod                                                                                                                           |
| Real-time  | `BranchEvent` change-feed table + Server-Sent Events (`/api/app/[tenant]/events`) with a polling fallback                    |
| QR codes   | `qrcode` library, generated in-house (SVG inline, PNG download)                                                               |
| Payments   | Pay-first mobile money: MTN MoMo Collections API, Airtel Africa Open API, plus a built-in simulator                         |
| Tests      | Vitest (unit + integration against the `zawli_test` DB), Playwright (E2E)                                                    |
| Lint       | ESLint 9 flat config + eslint-config-next (React Compiler rules), Prettier + Tailwind plugin                                 |
| Hosting    | One Linux VPS running Docker Compose: app + PostgreSQL + Caddy (automatic HTTPS) + nightly backups (`deploy/`)               |

### Folder map

```
prisma/                 schema.prisma, migrations/, seed.ts (two fictional restaurants)
src/domain/             pure business rules: money, pricing, order-status, phone, … (no DB)
src/server/services/    every DB operation, tenant-scoped, permission-checked
src/server/mobile-money/ MTN, Airtel and simulator clients + shared types
src/server/secrets.ts   AES-256-GCM encryption for stored provider credentials
src/app/t/…             public customer pages (QR menu, cart, order tracker, pay panel)
src/app/app/[tenant]/(shell)/…  restaurant app (dashboard, orders, menu, tables & QR, staff,
                        branches & kitchen, print queue, settings, billing, activity, kitchen, floor)
src/app/admin/…         platform administration (restaurants, onboarding, plans, invoices, audit)
src/app/api/…           JSON endpoints (handle() wrapper: same-origin check + error mapping)
src/instrumentation.ts  starts the 20-second mobile money sweeper
src/components/ui.tsx   shared UI components; theme tokens in globals.css
tests/unit, tests/integration   Vitest suites (incl. tenant-isolation.test.ts, pay-first.test.ts)
e2e/                    Playwright specs
scripts/                start-zawli.ps1, serve-local.ps1, create-admin.ts, local DB script
deploy/                 docker-compose.prod.yml, Caddyfile, .env.production.example
docs/                   ARCHITECTURE, DATABASE, SECURITY, ROADMAP, LOCAL_SETUP, DEPLOYMENT
```

### Request flow (customer order, pay-first)

1. The guest scans a table QR (`/t/<token>`). The token is resolved to tenant → branch → table, and the server works out the menu and prices.
2. The guest places an order. The server recomputes totals and creates the order as **`PENDING_PAYMENT`** with a `paymentDueBy` deadline (default 15 min). No kitchen tickets or prints are created yet.
3. The guest picks MTN or Airtel and enters a phone number. The server checks the number belongs to that network, creates a `PaymentIntent` and sends the provider a payment request (a prompt on the phone).
4. The server **pulls** payment status from the provider: the tracker polls every 3 s, a sweeper runs every 20 s, and callbacks only trigger a pull.
5. On `SUCCESSFUL`, in one transaction the server claims the intent, locks the order, writes a `PaymentRecord` (source `PROVIDER`), runs **`releaseToKitchen`** (order → `PLACED`, tickets per station, print jobs, `order.created` event), and the kitchen screen picks it up.
6. If the deadline passes with no successful payment and no prompt still pending, the order is cancelled ("Not paid in time").
7. Staff can still take payment at the restaurant. A full staff payment on a `PENDING_PAYMENT` order also releases it to the kitchen.

If a restaurant switches to **pay-after**, or has no provider enabled, ordering behaves exactly as before: orders go straight to `PLACED` and the kitchen.

---

## 3. What has been implemented

### Master prompt, phases 1–11 (all built)

- **Foundation:** project setup, theme (forest / ivory / charcoal / lime), brand made configurable (`NEXT_PUBLIC_BRAND_NAME`, `src/lib/brand.ts`), docs set, AGENTS.md.
- **Multi-tenancy and auth:** tenants, memberships, branch-level staff roles (`StaffBranchAssignment`), platform roles (SUPER_ADMIN, PLATFORM_BILLING, PLATFORM_SUPPORT), `TenantContext`, `requirePermission` / `requirePlatform` / `requireWritable`, suspended or read-only tenants, one-time setup tokens (sha256-hashed, 72 h), `npm run admin:create` bootstrap (no default admin password exists).
- **Menu:** categories, items, option groups/options, availability, images (stored on local disk under `storage/uploads`).
- **Tables & QR:** tables per branch, in-house QR generation (SVG + PNG download, 144-bit random tokens), revoke/regenerate. A table's PNG was checked byte-for-byte against the LAN URL (`http://192.168.110.121:3000/t/…`), and a fake token shows "This QR code isn't active".
- **Customer ordering:** QR menu, cart, server-side pricing (service charge, then tax, half-up rounding once; tax off by default), idempotent order placement, order tracker, call waiter, request bill.
- **Kitchen:** stations, routing items to stations, kitchen tickets per station, kitchen display (real-time), order status derived from tickets and only moving forward, optimistic concurrency.
- **Printing:** printer config per branch (DIGITAL / PRINTER / DIGITAL_AND_PRINTER), print job queue and API. _The helper app that actually prints (print bridge) is not built (see §4)._
- **Waiter floor:** phone-first real-time floor screen, waiter calls, bill requests.
- **Payments at the restaurant:** staff record cash / mobile money / other payments against bills, with idempotency keys and row locks; orders auto-complete when served and paid.
- **Reporting / dashboard / activity log:** audit rows for state changes.
- **SaaS billing & platform admin:** plans, manual invoices, restaurant onboarding, platform audit view.
- **Seed:** two fictional restaurants (incl. Kampala Grill) with demo orders. Idempotent and non-destructive; dev password documented in docs/LOCAL_SETUP.md.

### Added after the master prompt (at the user's request)

- **Pay-first with mobile money (MTN MoMo + Airtel Money only)**: see §2 request flow. It includes:
  - restaurant settings: payment timing (PAY_FIRST default / PAY_AFTER) and unpaid-order timeout (5–120 min, default 15)
  - per-restaurant MTN and Airtel merchant accounts, each with enabled flag, environment (SIMULATOR / SANDBOX / PRODUCTION), write-only encrypted credentials and a "Test connection" button. Only the owner can change them (`tenant.settings.manage`).
  - customer pay panel: provider choice, phone remembered on the device, countdown, waiting state, retry after a decline
  - refund flag: if money arrives for a cancelled or already-paid order, the system writes an audit row plus a staff notification (`payment.refund_needed`). Refunds themselves are manual.
  - simulator: a number ending `000` declines, `999` stays pending forever, any other number succeeds after about 5 s
- **Local testing launcher:** `Start Zawli.cmd`, `Rebuild and Start Zawli.cmd`, `scripts/start-zawli.ps1`. It starts the DB, applies migrations, seeds, builds if needed, sets APP_URL to the PC's Wi-Fi IP so phones can scan QR codes, and allows the simulator.
- **Testing guide:** [TESTING.md](TESTING.md).
- **Going-live kit:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) + `deploy/` (Docker Compose, Caddy, env example), Dockerfile uploads folder.

---

## 4. What remains

Not done yet, roughly by priority:

| Item                                         | Notes                                                                                                                       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Real-phone test                              | Scan → order → pay → kitchen from an actual phone on the Wi-Fi                                                              |
| `e2e/staff.spec.ts` / `e2e/helpers.ts`       | Unfinished or unverified leftovers; finish and run them, or remove them                                                     |
| Git + first commit                           | Git not installed on this machine                                                                                           |
| Hosting live                                 | Follow docs/DEPLOYMENT.md, **only with the user's explicit approval** (VPS, domain, live keys)                              |
| Live MTN / Airtel keys                       | Each restaurant needs its own merchant API credentials from MTN / Airtel; sandbox first                                     |
| Airtel request signing                       | Airtel's optional `x-signature` / encrypted-payload mode isn't implemented (plain OAuth2 calls only)                       |
| Print bridge helper app                      | Print job API exists; no local helper that pulls jobs and sends them to a thermal printer                                  |
| Click-testing remaining screens              | Not manually walked through: staff invites, option groups, routing/printers, print queue, bills, settings, plans, admin audit |
| i18n                                         | Copy is English; no message catalogs yet                                                                                    |
| Accessibility audit                          | Built with labels and contrast in mind, but no formal audit done                                                           |
| MFA                                          | Not implemented                                                                                                             |
| Email / SMS provider                         | None. Setup links are shown on screen to copy and share                                                                     |
| Multi-instance readiness                     | Rate limiter is in-memory, real-time signal is in-process, uploads are on local disk (fine on one server)                   |
| Tenant purge script                          | No tool yet to permanently delete a closed restaurant's data                                                               |
| CI pipeline                                  | None (needs Git + a host)                                                                                                   |

---

## 5. Important design decisions

- **Tenant isolation by construction:** every tenant row has `tenantId`, and children reference parents through composite FKs `(tenantId, parentId)` → `(tenantId, id)`, so a row can't point at another tenant's data even through a bug. Services scope every query. Another tenant's id gets a `notFound()` response, never "forbidden".
- **Authorization lives in services**, not pages. Each page also does its own auth check, because Next.js renders layouts and pages in parallel.
- **Never trust the browser** for prices, totals, availability, ids or status. Everything is recomputed on the server.
- **Money is stored as integer minor units**; rates are basis points; rounding happens once, half-up.
- **State machines** (`src/domain/order-status.ts`) control every status change, with history/audit rows inside a transaction.
- **Database is the source of truth for real-time.** SSE just signals "something changed"; clients re-read.
- **Pay-first only switches on when it can work:** `PAY_FIRST` setting **and** at least one enabled provider. Otherwise ordering falls back to pay-after.
- **Provider callbacks are never trusted.** A callback only triggers a status pull from the provider's API; the callback endpoint always returns 200.
- **Exactly one settlement per payment:** a unique pending-intent-per-order index, row locks on the order, a conditional claim of the intent, and idempotency keys.
- **Merchant accounts belong to each restaurant**: money goes straight to the restaurant's MTN/Airtel account, not through the platform. Credentials are AES-256-GCM-encrypted with `PAYMENT_SECRETS_KEY` and never shown again after saving.
- **Simulator gating:** the simulator is allowed in development, for demo tenants, or when `MOBILE_MONEY_SIMULATOR=allow` (set by the local launcher only). Without one of those it is refused in production.
- **PostgreSQL kept** rather than spreadsheets/Zapier: the user asked, the trade-offs were explained, and the user agreed. It is free locally and cheap on a VPS.
- **No default production admin:** the first admin is created with `npm run admin:create`, which prints a one-time setup link.
- **Single-server hosting first** (Docker Compose on one VPS) to keep costs low. Scaling notes are in docs/ROADMAP.md.

---

## 6. Database / backend status

- **Migrations** (both applied to the local dev DB `zawli`; the test DB `zawli_test` is migrated automatically by the test setup):
  1. `20261019131604_init`: full initial schema plus hand-written partial unique indexes and CHECK constraints.
  2. `20261020120000_pay_first_mobile_money`: `PENDING_PAYMENT` status, payment timing settings, `MobileMoneyAccount`, `PaymentIntent`, `PaymentRecord.source` (STAFF/PROVIDER), `recordedById` made optional, plus hand-written SQL: one pending intent per order, positive amount, timeout range 5–120, and a STAFF payment must have a recorder.
- **Note for future migrations:** `prisma migrate dev` refuses to run non-interactively here. Use `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<timestamp>_<name>/migration.sql`, append any hand-written SQL, then `npx prisma migrate deploy`. `prisma migrate reset` needs the user's explicit consent.
- **Seed:** idempotent. Kampala Grill has MTN + Airtel enabled in SIMULATOR mode.
- **Tests (last full run, 2026-10-20):** `npm test` → **9 files, 157 tests passed** (unit + integration + tenant isolation + pay-first). Typecheck and lint were clean then too.
- **Production build:** passed (`.next` built 2026-10-20 5:14 PM). The launcher was verified: DB up, app healthy, LAN URL serves the Kampala Grill menu.
- **End-to-end check in the browser:** a guest order paid through the MTN simulator moved to PLACED + PAID with 1 kitchen ticket and a PROVIDER / MOBILE_MONEY payment record.
- **E2E (Playwright):** `e2e/full-flow.spec.ts` is the main flow. `e2e/staff.spec.ts` + `e2e/helpers.ts` are unverified (see §1).
- **Background jobs:** in-process sweeper every 20 s (turn off with `ZAWLI_DISABLE_SWEEPER=1`); `/api/cron/payments` (Bearer `CRON_SECRET`) as an external trigger.

---

## 7. Files changed (pay-first feature and later work)

Everything else from phases 1–11 is new project code; this list covers the work after the master build.

**Database:** `prisma/schema.prisma`, `prisma/migrations/20261020120000_pay_first_mobile_money/migration.sql`, `prisma/seed.ts`

**Domain:** `src/domain/order-status.ts` (PENDING_PAYMENT transitions), `src/domain/phone.ts` (new: Uganda MTN/Airtel number checks, masking)

**Server:**
- `src/server/secrets.ts` (new)
- `src/server/mobile-money/types.ts`, `mtn.ts`, `airtel.ts`, `simulator.ts`, `index.ts` (new)
- `src/server/services/kitchen-release.ts` (new), `src/server/services/mobile-money.ts` (new)
- `src/server/services/ordering.ts` (pay-first order placement, public order payment state)
- `src/server/services/payments.ts` (staff payment releases a held order)
- `src/instrumentation.ts` (sweeper)

**Routes:** `src/app/api/public/orders/[publicToken]/pay/route.ts`, `src/app/api/public/payments/callback/route.ts`, `src/app/api/cron/payments/route.ts` (all new)

**UI:** `src/app/t/[token]/orders/[publicToken]/pay-panel.tsx` (new), `order-tracker.tsx`, `src/app/t/[token]/customer-menu.tsx`, `src/app/app/[tenant]/(shell)/settings/mobile-money-settings.tsx` + `mobile-money-actions.ts` (new) + settings page, menu preview page, order detail page, `src/lib/format.ts`

**Tests:** `tests/unit/mobile-money.test.ts`, `tests/integration/pay-first.test.ts` (new)

**Tooling / docs / deploy:** `Start Zawli.cmd`, `Rebuild and Start Zawli.cmd`, `scripts/start-zawli.ps1`, `scripts/serve-local.ps1`, `scripts/create-admin.ts`, `.claude/launch.json`, `TESTING.md`, `docs/DEPLOYMENT.md`, `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/.env.production.example`, `Dockerfile`, `.gitignore`, `.env.example`, `README.md`, `docs/ARCHITECTURE.md`, `package.json` (`admin:create`)

**Changed by another session (not this one):** `e2e/staff.spec.ts` (2026-10-21 1:24 PM), `e2e/helpers.ts`. The Remotion promo video lives outside this project in `E:\CLAUDE CODE\zawli-promo` and doesn't touch the app.

**Local-only, not source:** `build.log`, `install-dev.log`, `tsconfig.tsbuildinfo`, `test-results/`, `.next/`, `.pg-data/` (ignored or safe to delete).

---

## 8. Known issues and limits

- **Staff sign-in over the LAN:** in the local test setup, staff can sign in on `localhost` only, because secure cookies need HTTPS. Phones can still use the customer QR pages over Wi-Fi. This goes away once the app is hosted with HTTPS.
- **Real MTN/Airtel payments haven't been exercised.** The clients are unit-tested against mocked API responses and the full flow is tested with the simulator. MTN sandbox uses EUR and target `sandbox`.
- **Airtel `x-signature` request signing** isn't implemented (see §4).
- **Refunds are manual.** The system flags them; staff refund through the provider's merchant portal.
- **Single instance only:** in-memory rate limiter, in-process real-time signal, uploads on local disk.
- **No email/SMS:** setup links must be copied and shared by hand.
- **No MFA.**
- **No Git** on this machine, so there's no version history yet. Back up the folder before risky changes.
- **Slow machine** (~4 GB RAM): `next build` takes about 5–10 min and the dev server compiles slowly. Prefer the production launcher for testing, and stop the app/DB before rendering the promo video.
- **Dev-only npm audit findings** (via eslint-config-next dependencies); none in production dependencies at last check.
- **Deprecation warning** from the `pg` driver via the Prisma adapter at startup. Harmless.
- **Unverified E2E files:** `e2e/staff.spec.ts`, `e2e/helpers.ts`.

---

## 9. Hard rules still in force (from the master prompt)

- Don't purchase domains, register businesses, file trademarks, create paid services or make external purchases.
- Don't push code, deploy, or change external production systems without the user's explicit approval.
- Never commit real credentials, tokens, keys, production DB URLs or customer data.
- Never create default production admin credentials.
- Preserve the user's work; no destructive commands. `migrate reset` / `TRUNCATE` only on local or test DBs, and only with consent.
- Don't claim something works or that tests pass unless it has actually been run.
