import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { loadTenantContext } from "@/server/authz";
import {
  createTenant,
  getTenantReadiness,
  reissueOwnerSetupLink,
  setTenantStatus,
} from "@/server/services/platform-tenants";
import { completeAccountSetup, getSetupTokenInfo } from "@/server/services/accounts";
import { inviteStaff } from "@/server/services/staff";
import {
  changeSubscription,
  createInvoice,
  getTenantBilling,
  issueInvoice,
  recordInvoicePayment,
  runBillingSweep,
  voidInvoice,
} from "@/server/services/billing";
import { placeOrder } from "@/server/services/ordering";
import { createCategory, createMenuItem } from "@/server/services/menu";
import { createTable } from "@/server/services/tables";
import { ensurePlan, makeRestaurant, makeUser, sampleCart } from "../helpers/fixtures";
import type { SessionUser } from "@/server/authz";

let admin: SessionUser;
beforeAll(async () => {
  admin = await makeUser({ platformRole: "SUPER_ADMIN" });
});

const tokenFrom = (url: string) => url.split("/setup-account/")[1];

describe("tenant onboarding", () => {
  it("creates a tenant in ONBOARDING with branch, default station, owner and trial subscription", async () => {
    const res = await createTenant(admin, {
      name: "Nile Bistro",
      slug: "nile-bistro",
      branchName: "Jinja",
      ownerName: "Amina Owner",
      ownerEmail: "amina@nile-bistro.test",
      planId: await ensurePlan(),
    });
    expect(res.ownerSetupUrl).toMatch(/\/setup-account\/[A-Za-z0-9_-]{32}$/);
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: res.tenantId },
      include: { branches: { include: { stations: true } }, subscription: true, memberships: true, settings: true },
    });
    expect(tenant.status).toBe("ONBOARDING");
    expect(tenant.currency).toBe("UGX");
    expect(tenant.timezone).toBe("Africa/Kampala");
    expect(tenant.branches[0].stations[0].isDefault).toBe(true);
    expect(tenant.memberships[0]).toMatchObject({ role: "RESTAURANT_OWNER", allBranches: true });
    expect(tenant.subscription?.status).toBe("TRIAL");
    expect(tenant.settings?.taxEnabled).toBe(false);
    expect(await db.auditLog.count({ where: { tenantId: tenant.id, action: "tenant.created" } })).toBe(1);
  });

  it("rejects duplicate slugs and reserved names", async () => {
    const base = {
      name: "Copycat Bistro",
      branchName: "Main",
      ownerName: "Some One",
      ownerEmail: "x1@example.test",
      planId: await ensurePlan(),
    };
    await expect(createTenant(admin, { ...base, slug: "nile-bistro" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(createTenant(admin, { ...base, slug: "admin" })).rejects.toThrow();
  });

  it("blocks going live until the readiness checklist is complete", async () => {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "nile-bistro" } });
    await expect(setTenantStatus(admin, { tenantId: tenant.id, status: "ACTIVE" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    const missing = (await getTenantReadiness(tenant.id)).filter((r) => !r.done).map((r) => r.key);
    expect(missing).toEqual(expect.arrayContaining(["ownerLogin", "menu", "tables"]));
  });

  it("owner completes first login with a single-use setup link, configures, and the tenant goes live", async () => {
    const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: "nile-bistro" } });
    const owner = await db.user.findUniqueOrThrow({ where: { email: "amina@nile-bistro.test" } });
    const url = await reissueOwnerSetupLink(admin, { tenantId: tenant.id, userId: owner.id });
    const token = tokenFrom(url);
    expect(await getSetupTokenInfo(token)).toMatchObject({ email: "amina@nile-bistro.test" });

    await expect(completeAccountSetup({ token, password: "short", confirmPassword: "short" })).rejects.toThrow();
    await completeAccountSetup({ token, password: "NileBistro2026", confirmPassword: "NileBistro2026" });
    await expect(
      completeAccountSetup({ token, password: "NileBistro2026", confirmPassword: "NileBistro2026" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await getSetupTokenInfo(token)).toBeNull();
    const account = await db.account.findFirstOrThrow({ where: { userId: owner.id, providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain("NileBistro2026");

    const ctx = await loadTenantContext(
      { id: owner.id, name: owner.name, email: owner.email, platformRole: null },
      "nile-bistro",
    );
    const cat = await createCategory(ctx, { name: "Food" });
    await createMenuItem(ctx, { categoryId: cat.id, name: "Rolex", basePriceMinor: 7_000 });
    const branch = await db.branch.findFirstOrThrow({ where: { tenantId: tenant.id } });
    await createTable(ctx, { branchId: branch.id, label: "1" });

    await setTenantStatus(admin, { tenantId: tenant.id, status: "ACTIVE" });
    const live = await db.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    expect(live.status).toBe("ACTIVE");
    expect(live.onboardingCompletedAt).not.toBeNull();
  });

  it("rejects expired setup links", async () => {
    const r = await makeRestaurant();
    const { setupUrl } = await inviteStaff(r.owner, {
      name: "New Waiter",
      email: "late-waiter@example.test",
      role: "WAITER",
      branchIds: [r.branchId],
    });
    const token = tokenFrom(setupUrl!);
    await db.accountSetupToken.updateMany({
      where: { user: { email: "late-waiter@example.test" } },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(
      completeAccountSetup({ token, password: "Waiter2026xx", confirmPassword: "Waiter2026xx" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("suspension", () => {
  it("suspended tenants are read-only and stop accepting public orders, but keep their data", async () => {
    const r = await makeRestaurant();
    await placeOrder(sampleCart(r));
    await setTenantStatus(admin, { tenantId: r.tenantId, status: "SUSPENDED", reason: "Unpaid invoices" });
    const ctx = await loadTenantContext(r.owner.user, r.slug);
    expect(ctx.tenant.status).toBe("SUSPENDED");
    await expect(placeOrder(sampleCart(r))).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await expect(createCategory(ctx, { name: "New" })).rejects.toMatchObject({ code: "TENANT_SUSPENDED" });
    expect(await db.order.count({ where: { tenantId: r.tenantId } })).toBe(1);
    await setTenantStatus(admin, { tenantId: r.tenantId, status: "ACTIVE" });
    await expect(placeOrder(sampleCart(r))).resolves.toMatchObject({ duplicate: false });
  });

  it("requires a reason to suspend", async () => {
    const r = await makeRestaurant();
    await expect(setTenantStatus(admin, { tenantId: r.tenantId, status: "SUSPENDED" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("manual SaaS billing", () => {
  it("creates, issues and collects an invoice; numbering is sequential", async () => {
    const r = await makeRestaurant();
    const lines = [{ description: "Growth plan — October 2026", quantity: 1, unitPriceMinor: 350_000 }];
    const draft = await createInvoice(admin, {
      tenantId: r.tenantId,
      periodStart: new Date("2026-10-01"),
      periodEnd: new Date("2026-10-31"),
      dueDate: new Date("2026-10-15"),
      lines,
    });
    expect(draft.status).toBe("DRAFT");
    expect(draft.number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect((await getTenantBilling(r.owner)).invoices.some((i) => i.id === draft.id)).toBe(false); // drafts hidden
    await issueInvoice(admin, { invoiceId: draft.id });
    const second = await createInvoice(admin, {
      tenantId: r.tenantId,
      periodStart: new Date(),
      periodEnd: new Date(),
      dueDate: new Date(),
      lines,
      issue: true,
    });
    expect(Number(second.number.slice(-5))).toBe(Number(draft.number.slice(-5)) + 1);

    await recordInvoicePayment(admin, {
      invoiceId: draft.id,
      amountMinor: 150_000,
      method: "MOBILE_MONEY",
      reference: "MM-1",
      receivedAt: new Date(),
    });
    let inv = await db.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(inv.status).toBe("PARTIALLY_PAID");
    await expect(
      recordInvoicePayment(admin, {
        invoiceId: draft.id,
        amountMinor: 999_999,
        method: "CASH",
        receivedAt: new Date(),
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await recordInvoicePayment(admin, {
      invoiceId: draft.id,
      amountMinor: 200_000,
      method: "CASH",
      receivedAt: new Date(),
    });
    inv = await db.invoice.findUniqueOrThrow({ where: { id: draft.id } });
    expect(inv.status).toBe("PAID");
    expect(inv.paidAt).not.toBeNull();
    await expect(voidInvoice(admin, { invoiceId: draft.id, reason: "mistake" })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await voidInvoice(admin, { invoiceId: second.id, reason: "Duplicate" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: second.id } })).status).toBe("VOID");
  });

  it("moves overdue subscriptions to PAST_DUE and back to ACTIVE when paid; suspension follows the subscription", async () => {
    const r = await makeRestaurant();
    await changeSubscription(admin, { tenantId: r.tenantId, status: "ACTIVE", reason: "Paid upfront" });
    const inv = await createInvoice(admin, {
      tenantId: r.tenantId,
      periodStart: new Date("2026-09-01"),
      periodEnd: new Date("2026-09-30"),
      dueDate: new Date(Date.now() - 86_400_000),
      lines: [{ description: "Plan", quantity: 1, unitPriceMinor: 100_000 }],
      issue: true,
    });
    await runBillingSweep(admin);
    expect((await db.subscription.findUniqueOrThrow({ where: { tenantId: r.tenantId } })).status).toBe("PAST_DUE");
    expect((await db.tenant.findUniqueOrThrow({ where: { id: r.tenantId } })).status).toBe("ACTIVE"); // past due ≠ suspended

    await changeSubscription(admin, { tenantId: r.tenantId, status: "SUSPENDED", reason: "60 days overdue" });
    expect((await db.tenant.findUniqueOrThrow({ where: { id: r.tenantId } })).status).toBe("SUSPENDED");
    await expect(
      changeSubscription(admin, { tenantId: r.tenantId, status: "PAST_DUE", reason: "invalid" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    await recordInvoicePayment(admin, {
      invoiceId: inv.id,
      amountMinor: 100_000,
      method: "CASH",
      receivedAt: new Date(),
    });
    // Suspended stays suspended until a human reactivates it.
    expect((await db.subscription.findUniqueOrThrow({ where: { tenantId: r.tenantId } })).status).toBe("SUSPENDED");
    await changeSubscription(admin, { tenantId: r.tenantId, status: "ACTIVE", reason: "Paid in full" });
    expect((await db.tenant.findUniqueOrThrow({ where: { id: r.tenantId } })).status).toBe("ACTIVE");
    const events = await db.subscriptionEvent.findMany({
      where: { tenantId: r.tenantId },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.toStatus)).toEqual(["TRIAL", "ACTIVE", "PAST_DUE", "SUSPENDED", "ACTIVE"]);
  });

  it("keeps SaaS billing separate from restaurant order payments", async () => {
    const r = await makeRestaurant();
    await placeOrder(sampleCart(r));
    const before = await db.paymentRecord.count({ where: { tenantId: r.tenantId } });
    const inv = await createInvoice(admin, {
      tenantId: r.tenantId,
      periodStart: new Date(),
      periodEnd: new Date(),
      dueDate: new Date(),
      lines: [{ description: "Plan", quantity: 1, unitPriceMinor: 1_000 }],
      issue: true,
    });
    await recordInvoicePayment(admin, {
      invoiceId: inv.id,
      amountMinor: 1_000,
      method: "CASH",
      receivedAt: new Date(),
    });
    expect(await db.paymentRecord.count({ where: { tenantId: r.tenantId } })).toBe(before);
  });
});
