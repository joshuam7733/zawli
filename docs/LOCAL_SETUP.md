# Local setup

## 1. Prerequisites

- Node.js **20.19 or newer** (developed on Node 24) and npm 10+.
- Optional: Docker Desktop (alternative way to run PostgreSQL).
- Optional: Git (the project folder was created without Git; run `git init` to start version control).

## 2. Install

```bash
npm install
```

npm 11 may report that some packages' install scripts are "not yet covered by allowScripts". Zawli needs these: `prisma`, `@prisma/engines`, `@embedded-postgres/<your-platform>`, `esbuild`, `unrs-resolver`. Approve and rebuild them once:

```bash
npm install-scripts approve prisma @prisma/engines esbuild unrs-resolver @embedded-postgres/windows-x64
npm rebuild prisma @prisma/engines esbuild unrs-resolver @embedded-postgres/windows-x64
```

(Use the `@embedded-postgres/…` package for your OS, e.g. `darwin-arm64` or `linux-x64`.)

## 3. Environment

```bash
cp .env.example .env
```

Generate a secret and put it in `BETTER_AUTH_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## 4. Database

**Option A — no Docker (default).** Keep this running in its own terminal:

```bash
npm run db:local
```

It starts a real PostgreSQL server from the `embedded-postgres` npm package on `localhost:54329` (UTF-8, UTC), storing data in `./.pg-data`, and creates the `zawli` and `zawli_test` databases. Stop it with Ctrl+C.

**Option B — Docker.**

```bash
docker compose up -d db
```

Then change the port in `DATABASE_URL` and `TEST_DATABASE_URL` to `5432`.

Apply migrations and seed demo data:

```bash
npx prisma migrate deploy
npm run db:seed
```

The seed is repeatable: existing demo restaurants are left untouched and nothing is deleted.

## 5. Run

```bash
npm run dev
```

Open http://localhost:3000.

## Demo accounts (development only)

Every seeded account uses the password **`ZawliDemo2026`**. These exist only in your local database; the seed refuses to run with `NODE_ENV=production`.

| Email                                                      | Role                  | Notes                                                           |
| ---------------------------------------------------------- | --------------------- | --------------------------------------------------------------- |
| `admin@zawli.test`                                         | Platform super admin  | `/admin`                                                        |
| `billing@zawli.test`                                       | Platform billing      | invoices & subscriptions only                                   |
| `owner@kampala-grill.test`                                 | Owner, Kampala Grill  | 2 branches (Kololo: kitchen display; Ntinda: display + printer) |
| `manager@kampala-grill.test`                               | Manager, all branches |                                                                 |
| `waiter@kampala-grill.test`                                | Waiter, Kololo only   | floor screen                                                    |
| `kitchen@kampala-grill.test`                               | Kitchen, Kololo only  | kitchen screen                                                  |
| `owner@lakeside-cafe.test`                                 | Owner, Lakeside Café  | printer mode, 5% service charge, trial                          |
| `waiter@lakeside-cafe.test` / `kitchen@lakeside-cafe.test` |                       |                                                                 |

Both restaurants are clearly fictional and flagged as demo data in the UI.

### Trying the customer flow

Sign in as an owner → **Tables & QR codes** → download a QR code, or copy the link under a table's QR code. Open `/t/<token>` on your phone (same network: use the "Network" URL printed by `npm run dev`) or in a browser window. Place an order and watch it appear on **Kitchen display**.

## Tests

```bash
npm test            # unit + integration + tenant-isolation tests
npm run test:e2e    # Playwright end-to-end flow (see below)
```

Integration tests use `TEST_DATABASE_URL` (the database name must contain "test"); the suite migrates it and empties it at the start of every run. They never touch the development database.

End-to-end tests drive a real browser against `npm run dev` with seeded demo data:

```bash
npx playwright install chromium   # once
npm run test:e2e
```

## Troubleshooting

- **`DATABASE_URL is not set`** — create `.env` (step 3).
- **Port 54329 in use** — another `db:local` is running, or change `LOCAL_PG_PORT` and both URLs.
- **`prisma migrate reset` refuses to run** — Prisma blocks destructive resets when invoked by an AI agent without explicit consent. Run it yourself if you really want to wipe your local database.
- **Fonts fail to load during `next build`** — the build downloads Google Fonts once; it needs internet access.
- **A pg deprecation warning in test output** (“Calling client.query() when the client is already executing a query”) comes from Prisma's driver adapter inside transactions; it is harmless and tracked upstream.
