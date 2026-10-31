# Zawli

**Every table. Every order. One system.** _(working name and tagline — both provisional)_

Zawli is a multi-tenant restaurant operations SaaS: QR ordering at the table, a kitchen display and printable kitchen tickets, a waiter floor screen, pay-at-the-restaurant payment records, reporting, and manual SaaS billing run by the platform team. One codebase and one database serve many independent restaurants with strict tenant isolation.

Initial market: Uganda (UGX, Africa/Kampala defaults). Nothing Uganda-specific is hardcoded: currency, timezone, locale, tax and service charge are per-tenant settings.

## Quick start (local development)

Requirements: **Node.js 20.19+** (tested on 24) and npm. Docker is optional.

```bash
npm install
cp .env.example .env            # then set BETTER_AUTH_SECRET (see the file)
npm run db:local                # terminal 1: starts PostgreSQL (no Docker needed)
npx prisma migrate deploy       # terminal 2
npm run db:seed                 # fictional demo data
npm run dev                     # http://localhost:3000
```

Full instructions, Docker alternative and demo accounts: [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## What's in the box

| Area                                                                                                                          | Where                    |
| ----------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Customer QR menu, cart, order tracking, waiter call / bill request                                                            | `/t/<qr-token>`          |
| Restaurant app: dashboard, orders, menu, tables & QR, staff, branches & kitchen, print queue, settings, billing, activity log | `/app/<restaurant-slug>` |
| Kitchen display (real-time)                                                                                                   | `/app/<slug>/kitchen`    |
| Waiter floor screen (real-time, phone-first)                                                                                  | `/app/<slug>/floor`      |
| Platform administration: restaurants, onboarding, plans, invoices, audit                                                      | `/admin`                 |
| Health check                                                                                                                  | `/api/health`            |

## Scripts

| Command                                 | Purpose                                                                |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `npm run dev`                           | Next.js dev server                                                     |
| `npm run db:local`                      | Local PostgreSQL via `embedded-postgres` (port 54329)                  |
| `npm run db:migrate` / `db:deploy`      | Create / apply migrations                                              |
| `npm run db:seed`                       | Repeatable, non-destructive demo seed                                  |
| `npm test`                              | Unit + integration + tenant-isolation tests (uses `TEST_DATABASE_URL`) |
| `npm run test:e2e`                      | Playwright end-to-end flow (needs the dev server and seeded DB)        |
| `npm run typecheck` / `lint` / `format` | Code quality                                                           |
| `npm run build`                         | Production build                                                       |

## Testing on this computer

Double-click **`Start Zawli.cmd`** — see [TESTING.md](TESTING.md).

## Going live

Step-by-step guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (one server with Docker: app + PostgreSQL + automatic HTTPS + daily backups, files in `deploy/`).

## Deploying (outline)

1. Managed PostgreSQL with backups + point-in-time recovery (see docs/DATABASE.md).
2. Set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`/`APP_URL` (your HTTPS origin) as secrets.
3. Build the Docker image (`Dockerfile`) — it runs `prisma migrate deploy` on start — or run `npm ci && npm run build && npx prisma migrate deploy && npm start`.
4. Create the first platform admin (no default password is ever created):
   ```bash
   BOOTSTRAP_ADMIN_EMAIL=you@example.com BOOTSTRAP_ADMIN_NAME="Your Name" npm run admin:create
   ```
   It prints a one-time setup link.
5. Before running more than one instance, read the scaling notes in docs/ROADMAP.md (rate limiter, real-time signal, uploads).

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack, structure, multi-tenancy, ordering, kitchen, real-time, printing, payments, billing
- [docs/DATABASE.md](docs/DATABASE.md) — data model, invariants, money, migrations, backups
- [docs/SECURITY.md](docs/SECURITY.md) — threat model, isolation, auth, suspension rules
- [docs/ROADMAP.md](docs/ROADMAP.md) — phase status, known limitations, next steps
- [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md) — setup, demo accounts, troubleshooting
- [AGENTS.md](AGENTS.md) — conventions for contributors and coding agents

## Brand

"Zawli" is provisional pending name and domain clearance. Change `NEXT_PUBLIC_BRAND_NAME` and `src/lib/brand.ts` / `src/components/brand.tsx` to rebrand. No domains, trademarks or paid services have been registered.
