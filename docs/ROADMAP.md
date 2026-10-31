# Roadmap

Status as of 19 Oct 2026. "Done" means implemented **and** covered by automated tests or verified in a browser, as noted.

## Phases

| #   | Phase                                                                                                                 | Status                         | Evidence                                                             |
| --- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------- |
| 1   | Foundation: Next.js 16, Prisma 7/PostgreSQL, Better Auth, Docker Compose + embedded Postgres, schema, migration, seed | Done                           | migration applied; seed run twice (idempotent); typecheck/lint clean |
| 2   | Tenants, memberships, roles, branch scoping, isolation tests                                                          | Done                           | `tenant-isolation.test.ts` (30+ cases incl. DB-level FK rejection)   |
| 3   | Onboarding, settings, branches, tables, secure QR                                                                     | Done                           | `platform-accounts.test.ts`, `ordering.test.ts`; UI verified         |
| 4   | Menu: categories, items, variants, modifiers, availability, branch overrides, preview                                 | Done                           | service tests; UI verified in browser                                |
| 5   | Customer QR ordering, cart, sessions, idempotent transactional orders, tracking                                       | Done                           | concurrency/idempotency tests; real order placed in browser          |
| 6   | Kitchen tickets, routing, KDS, controlled transitions, SSE + polling                                                  | Done                           | tests; live update measured at ~0.4 s in browser                     |
| 7   | Waiter calls, bill requests, floor screen, serving                                                                    | Done                           | tests; floor UI built                                                |
| 8   | Fulfilment modes, printer config, print jobs, browser-printable tickets, print-bridge API                             | Done (bridge helper not built) | tests for job dedupe and ticket layout                               |
| 9   | Pay-at-restaurant payments, voids, table settlement; manual invoices, subscriptions                                   | Done                           | payment + billing tests                                              |
| 10  | Dashboard/reports, CSV export, audit views, responsive/accessibility pass                                             | Done (first pass)              | —                                                                    |
| 11  | Final verification                                                                                                    | Done for V1 scope              | see "Verification results"                                           |

## Verification results (19 Oct 2026)

| Check                                                                        | Result                                                                           |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `npm run typecheck` / `npm run lint` / `npm run format:check`                | pass / pass (0 problems) / pass                                                  |
| `npm test` — unit + integration + tenant isolation                           | **126 / 126 pass** (7 files)                                                     |
| `npm run build` (production)                                                 | pass                                                                             |
| `npm run test:e2e` — 13-step flow from the brief, Chromium, production build | **pass**                                                                         |
| `npm audit --omit=dev`                                                       | 0 vulnerabilities                                                                |
| `npm audit` including dev tools                                              | 5 high in `braces` via `eslint-config-next` (dev-only lint tooling, not shipped) |
| Migration on a fresh database / seed run twice                               | pass / idempotent                                                                |

The E2E test covers: admin creates a restaurant → owner first-login link → branch, category, item, table + QR → go live → anonymous customer orders on a phone viewport → kitchen display acknowledge/prepare/ready → customer sees "ready" → floor screen serve → cash payment with change → dashboard → admin issues an invoice visible to the owner → another tenant's owner gets 404 for the pages, API and `/admin`.

`e2e/staff.spec.ts` (21 Oct 2026, passing) covers the staff screen: invite a waiter (one-time setup link) → change branches → reissue the link (old link expires) → waiter completes setup, lands on the floor screen, gets 404 for staff/settings/branches/billing and a read-only menu → deactivate (access removed) → reactivate.

**Built, type-checked and compiled but not click-tested in a browser:** option-group editor, branch kitchen routing and printer forms, print queue and ticket print page, table bill page, restaurant settings, plans, platform audit page. Their underlying services are covered by the integration tests.

## Known limitations (honest list)

- **Print bridge helper app** is not built. The API contract (`/api/print-bridge/jobs`, `/ack`), key management and ticket text format are implemented and tested. Until then, use browser printing (print dialog per ticket — browsers cannot print silently).
- **No email/SMS sending.** Setup links are shown once to the admin/owner to share manually. Integrating a provider (and "forgot password" by email) is next.
- **No online payments.** By design for V1. Mobile money references are recorded but not verified.
- **Rate limiting is in-memory** (single instance). Use Redis/Postgres before running several instances.
- **Real-time wake-up is in-process**; other instances still see changes within ≤ 15 s via DB polling. Add Postgres `LISTEN/NOTIFY` for instant cross-instance updates.
- **Uploads use local disk** (`storage/uploads`). Production needs object storage (S3/R2) behind `src/server/storage.ts`.
- **No MFA** for platform admins yet.
- **Translations:** UI is English; strings are not yet extracted into message catalogues.
- **Reports** are operational (orders, value, collected, popular items, branches, payment methods). No accounting exports beyond the orders CSV.
- **Tenant data purge** (lawful erasure) needs a dedicated audited script.
- **Inventory/stock levels** are not implemented (only manual sold-out switches).
- The repository was not under Git when work started and Git is not installed on the development machine; initialise version control before collaborating.

## Next steps (suggested order)

1. Initialise Git, add CI (typecheck, lint, unit/integration tests against a Postgres service, build, `npm audit`).
2. Email/SMS provider for invites and password reset; MFA for platform roles.
3. Print bridge helper (Node or Go) for ESC/POS thermal printers on the restaurant LAN.
4. Shared rate limiter + `LISTEN/NOTIFY`; object storage for images; deploy to a managed Postgres + container host.
5. Staff-entered orders (no QR), table transfers/merges, item-level cancellation.
6. Message catalogues (English + Luganda/Swahili candidates).
7. Online payments (mobile money aggregator) through the existing `recordPayment` path; automated SaaS billing.
