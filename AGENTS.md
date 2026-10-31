# AGENTS.md — working on Zawli

Guidance for human contributors and coding agents.

## Golden rules

1. **Tenant isolation first.** Every query on tenant data includes `tenantId: ctx.tenant.id`. Look up client-supplied ids _within the tenant_ and report misses as `notFound()` (never "forbidden" for another tenant's record). New tenant-owned tables get `tenantId`, `@@unique([tenantId, id])`, and composite FKs to their parents.
2. **Authorize in services, not in the UI.** Every exported service function that touches tenant data takes a `TenantContext` (or `SessionUser` for platform work) and calls `requirePermission` / `requirePlatform` / `requireWritable` before writing.
3. **Never trust the browser** for prices, totals, availability, tenant/branch ids or status. Recompute on the server.
4. **Money is integer minor units.** Use `src/domain/money.ts` / `pricing.ts`. No floats for stored amounts.
5. **State changes go through the state machines** in `src/domain` with history/audit rows, inside a transaction, with optimistic checks.
6. **Write a test for every rule and every new endpoint**, including a cross-tenant test in `tests/integration/tenant-isolation.test.ts`.
7. **No secrets or personal data in logs, audit metadata, URLs or commits.**

## Where things go

| You are adding…      | Put it in                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------- |
| A pure business rule | `src/domain/*.ts` + `tests/unit`                                                                              |
| A database operation | `src/server/services/<area>.ts` + `tests/integration`                                                         |
| A page               | `src/app/app/[tenant]/(shell)/…` (restaurant), `src/app/admin/…` (platform), `src/app/t/…` (public)           |
| A form mutation      | a `"use server"` `actions.ts` next to the page, wrapping a service with `runAction`                           |
| A JSON endpoint      | `src/app/api/…/route.ts` using `handle()` (same-origin check + error mapping)                                 |
| A schema change      | `prisma/schema.prisma` → `npm run db:migrate -- --name …` (append hand-written SQL before applying if needed) |

## Commands

```bash
npm run db:local        # PostgreSQL without Docker
npm run dev
npm run typecheck && npm run lint && npm test
npm run build
npm run test:e2e        # needs a running, seeded app
```

## Conventions

- TypeScript strict; Zod for input; `AppError` helpers (`notFound`, `forbidden`, `validation`, `conflict`) for expected failures.
- UI: components in `src/components/ui.tsx`; colours from the theme tokens in `globals.css` (forest / ivory / charcoal / lime). Lime is an accent — never body text on light backgrounds. Kitchen screens favour legibility over decoration.
- Copy: plain English, verb-first buttons, errors explain how to recover.
- Next.js 16: `params`/`searchParams` are promises; `proxy.ts` (not middleware); page files may only export Next.js page exports.
- Do not run destructive database commands (`migrate reset`, `TRUNCATE`) against anything except your local or test database.
