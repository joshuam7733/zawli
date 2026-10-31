# Database

PostgreSQL, managed with Prisma 7 (`prisma/schema.prisma`, migrations in `prisma/migrations`). The Prisma client is generated into `src/generated/prisma` (git-ignored; `npm install` runs `prisma generate`).

## Conventions

- **Tenant scoping.** Every tenant-owned table has `tenantId`. Tenant-owned parents expose `@@unique([tenantId, id])`, and children reference them with composite foreign keys `(tenantId, parentId)`. A row can therefore never link records of two tenants — Postgres rejects it.
- **Ids.** `cuid()` strings. Ids are _not_ security tokens; QR codes, customer order links, setup links and print-bridge keys use separate random tokens.
- **Money.** Integer **minor units** (`…Minor` columns), in the tenant currency. UGX has no minor unit, so UGX 25,000 is `25000`; KES 250.50 is `25050`. Percentages are basis points (`…Bps`, 1% = 100). No floating-point arithmetic touches stored money.
- **Time.** Written in UTC (`timestamp(3)`, server timezone UTC); displayed in the tenant/branch timezone.
- **Snapshots.** `OrderItem` and `OrderItemModifier` copy names, variant, category, allergens and prices at order time. Links back to the menu (`menuItemId`, …) are for reporting only.
- **Soft lifecycle.** Menu items, categories, variants, option groups, tables and branches are archived/deactivated, not deleted, so history stays intact. Tenants are suspended/deactivated, never hard-deleted by the app.

## Main entities

| Group              | Tables                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth (Better Auth) | `User` (+ `platformRole`, `isActive`), `Session`, `Account` (password hash), `Verification`, `AccountSetupToken` (hashed one-time links)                      |
| Tenancy            | `Tenant`, `RestaurantSettings` (1:1), `Branch`, `Membership`, `StaffBranchAssignment`                                                                         |
| Menu               | `MenuCategory`, `MenuItem`, `MenuItemBranch` (per-branch offer/stock override), `MenuItemVariant`, `ModifierGroup`, `ModifierOption`, `MenuItemModifierGroup` |
| Tables             | `DiningTable`, `TableQrToken`, `TableSession`, `ServiceRequest` (waiter call / bill request)                                                                  |
| Orders             | `Order`, `OrderItem`, `OrderItemModifier`, `OrderStatusHistory`, `PaymentRecord`                                                                              |
| Kitchen            | `KitchenStation`, `KitchenRoutingRule`, `KitchenTicket`, `PrinterConfiguration`, `PrintJob`                                                                   |
| SaaS billing       | `SubscriptionPlan`, `Subscription`, `SubscriptionEvent`, `Invoice`, `InvoiceLine`, `InvoicePayment`                                                           |
| Operations         | `Counter` (atomic sequences), `BranchEvent` (real-time change feed), `Notification`, `AuditLog`                                                               |

Differences from the original brief, by design: a single menu per tenant (branch differences via `MenuItemBranch`) instead of a separate `Menu` table; `WaiterCall` and `BillRequest` are one `ServiceRequest` table with a `type`; `TableQrToken` replaces a generic `TableQRCode`.

## Database-enforced invariants

Besides composite FKs and unique constraints, the initial migration adds (see the end of `prisma/migrations/*_init/migration.sql`):

- one **ACTIVE** QR token per table; one **OPEN** session per table; one **default** kitchen station per branch (partial unique indexes)
- one ticket per (order, station); one print job per (ticket, printer); unique `(tenantId, idempotencyKey)` for orders and payments; unique `(tenantId, orderNumber)`
- `Order`: `total = subtotal + service charge + added tax`, `0 ≤ paid ≤ total`
- `OrderItem`: `quantity > 0`, `line total = (unit + modifiers) × quantity`
- non-negative prices; payments > 0 and tendered ≥ amount; modifier `min ≤ max`
- invoice totals consistent, paid ≤ total; settings rates 0–100%; printer paper 58/80/210 mm
- a routing rule targets exactly one of category / item
- partial index for active kitchen tickets per branch

## Concurrency

- Order placement locks the `DiningTable` row (`SELECT … FOR UPDATE`) so simultaneous first orders share one session.
- Order and invoice numbers come from `Counter` with `INSERT … ON CONFLICT DO UPDATE … RETURNING` inside the transaction.
- Status transitions and payments use optimistic checks (`updateMany … where status/amountPaid = expected`) plus row locks for payments.

## Migrations

```bash
npm run db:migrate -- --name <change>   # development: create + apply
npm run db:deploy                       # CI / production: apply pending migrations only
```

Never edit an applied migration; add a new one. Hand-written SQL (partial indexes, CHECK constraints) goes at the end of the generated migration file before it is applied.

## Backups and restore

Production should use a managed PostgreSQL service with automated daily snapshots **and** point-in-time recovery (WAL archiving), retained ≥ 14 days. In addition, take a logical backup before every migration:

```bash
pg_dump --format=custom --no-owner --file=zawli-$(date +%F).dump "$DATABASE_URL"
pg_restore --clean --if-exists --no-owner --dbname "$TARGET_URL" zawli-YYYY-MM-DD.dump
```

Test a restore into a scratch database at least monthly (then run `npx prisma migrate status` against it).

Local development data lives in `./.pg-data` (embedded server) or the `zawli-pg` Docker volume.

## Retention

- Orders, payments, invoices and audit logs are kept for the life of the tenant (financial records). A tenant purge on lawful request is a manual, audited operation (script to be written; see ROADMAP).
- Sessions expire after 12 hours; used/expired setup tokens can be deleted after 30 days.
- `BranchEvent` rows are only needed for minutes; prune rows older than 7 days on a schedule (`DELETE FROM "BranchEvent" WHERE "createdAt" < now() - interval '7 days'`).
- Customers are anonymous; the only optional personal data is a first name and notes typed into an order.
