// End-to-end: the 13-step flow from the product brief, through the real UI.
// Requires the seeded development database (admin@zawli.test, Kampala Grill demo).
import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO_PASSWORD = "ZawliDemo2026";
const RUN = Date.now().toString(36);
const RESTAURANT = `E2E Bistro ${RUN}`;
const SLUG = `e2e-bistro-${RUN}`;
const OWNER_EMAIL = `owner-${RUN}@e2e.test`;
const OWNER_PASSWORD = "E2eOwnerPass2026";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

test("platform → restaurant → customer → kitchen → floor → payment → invoice → isolation", async ({ browser }) => {
  // 1. Platform administrator creates a restaurant.
  const admin = await newPage(browser);
  await signIn(admin, "admin@zawli.test", DEMO_PASSWORD);
  await admin.goto("/admin/tenants/new");
  await admin.getByLabel("Name", { exact: true }).fill(RESTAURANT);
  await admin.getByLabel("Slug").fill(SLUG);
  await admin.getByLabel("Branch name").fill("Main");
  await admin.getByLabel("Owner name").fill("Esther E2E");
  await admin.getByLabel("Owner email").fill(OWNER_EMAIL);
  const growth = await admin.locator("#planId option", { hasText: "Growth" }).getAttribute("value");
  await admin.getByLabel("Plan").selectOption(growth!);
  await admin.getByRole("button", { name: "Create restaurant" }).click();
  await expect(admin.getByText("Restaurant created")).toBeVisible();
  const setupUrl = await admin.getByLabel("Owner's first-login link").inputValue();
  expect(setupUrl).toContain("/setup-account/");

  // 2. Restaurant owner signs in (first-login link → password).
  const owner = await newPage(browser);
  await owner.goto(new URL(setupUrl).pathname);
  await owner.getByLabel("New password").fill(OWNER_PASSWORD);
  await owner.getByLabel("Confirm password").fill(OWNER_PASSWORD);
  await owner.getByRole("button", { name: "Save password and continue" }).click();
  await owner.waitForURL(new RegExp(`/app/${SLUG}`));

  // 3. Owner creates a branch, a table, a menu category and a menu item.
  await owner.goto(`/app/${SLUG}/branches`);
  await owner.locator("#new-branch-name").fill("Riverside");
  await owner.locator("#new-branch-slug").fill("riverside");
  await owner.getByRole("button", { name: "Create branch" }).click();
  await expect(owner.getByRole("heading", { name: /Riverside/ })).toBeVisible();

  await owner.goto(`/app/${SLUG}/menu`);
  await owner.getByLabel("Name").fill("Mains");
  await owner.getByRole("button", { name: "Add category" }).click();
  await expect(owner.getByRole("heading", { name: "Mains" })).toBeVisible();
  await owner.getByRole("link", { name: "New item" }).click();
  await owner.waitForURL(/\/menu\/items\/new/);
  await owner.getByLabel("Name").fill("Chicken luwombo");
  await owner.getByLabel(/^Price/).fill("30000");
  await owner.getByLabel("Allergens").fill("Peanuts");
  await owner.getByRole("button", { name: "Create item" }).click();
  await owner.waitForURL(/\/menu\/items\//);

  // 4. The system generates a table QR code.
  await owner.goto(`/app/${SLUG}/tables`);
  await owner.getByLabel("Label").fill("7");
  await owner.getByRole("button", { name: "Add table" }).click();
  await expect(owner.getByText("Table 7")).toBeVisible();
  await expect(owner.getByRole("img", { name: "QR code for table 7" })).toBeVisible();
  const menuHref = await owner.getByRole("link", { name: "Open menu" }).first().getAttribute("href");
  expect(menuHref).toMatch(/^\/t\/[A-Za-z0-9_-]{24}$/);

  // Platform admin switches the restaurant live (checklist complete).
  await admin.goto("/admin/tenants");
  await admin.getByRole("link", { name: RESTAURANT }).click();
  await admin.getByLabel("New status").selectOption("ACTIVE");
  await admin.getByRole("button", { name: "Change status" }).click();
  await expect(admin.getByText("Live", { exact: true }).first()).toBeVisible();

  // 5. A customer scans the QR code and orders without an account.
  const customer = await newPage(browser);
  await customer.setViewportSize({ width: 390, height: 844 });
  await customer.goto(menuHref!);
  await expect(customer.getByRole("heading", { name: RESTAURANT })).toBeVisible();
  await customer.getByRole("button", { name: /Chicken luwombo/ }).click();
  await customer.getByRole("dialog").getByLabel("Note for the kitchen").fill("Extra hot");
  await customer.getByRole("button", { name: /Add to order/ }).click();
  await customer.getByRole("button", { name: /View order/ }).click();
  await customer.getByLabel("Your name (optional)").fill("Amani");
  await customer.getByRole("button", { name: /Send order/ }).click();
  await customer.waitForURL(/\/orders\//);
  const reference = (await customer.getByRole("heading", { name: /Order #/ }).textContent())!.match(/#(\d+)/)![1];
  await expect(customer.getByText("We've got your order")).toBeVisible();

  // 6–8. The order appears on the kitchen display; kitchen acknowledges, prepares, marks ready.
  await owner.goto(`/app/${SLUG}/kitchen`);
  const ticket = owner.locator("li", { has: owner.getByText(`#${reference}`, { exact: true }) });
  await expect(ticket.getByText("Chicken luwombo")).toBeVisible();
  await expect(ticket.getByText("Allergens: Peanuts")).toBeVisible();
  await ticket.getByRole("button", { name: "Acknowledge" }).click();
  await ticket.getByRole("button", { name: "Start preparing" }).click();
  await ticket.getByRole("button", { name: "Mark ready" }).click();
  await expect(ticket.getByText("Waiting for pickup")).toBeVisible();

  // The customer's tracker reflects it (polls every 8 s).
  await expect(customer.getByText("Your order is ready")).toBeVisible({ timeout: 30_000 });

  // 9. A waiter serves the order (floor screen).
  await owner.goto(`/app/${SLUG}/floor`);
  const ready = owner.locator("li", { hasText: `#${reference}` });
  await ready.getByRole("button", { name: "Served" }).click();
  await expect(owner.getByText("All caught up")).toBeVisible();

  // 10. Authorised staff record payment at the restaurant.
  await owner.goto(`/app/${SLUG}/orders?scope=today`);
  await owner.getByRole("link", { name: `#${reference}` }).click();
  await owner.getByLabel("Method").selectOption("CASH");
  await owner.getByLabel(/Cash handed over/).fill("50000");
  await owner.getByRole("button", { name: "Record payment" }).click();
  await expect(owner.getByText(/give USh\s?20,000 change/)).toBeVisible();

  // 11. The order and reporting records update.
  await expect(owner.getByText("Completed").first()).toBeVisible();
  await owner.goto(`/app/${SLUG}`);
  await expect(owner.getByText("1 payment recorded", { exact: false })).toBeVisible();

  // 12. The platform administrator creates a manual subscription invoice.
  await admin.goto("/admin/tenants");
  await admin.getByRole("link", { name: RESTAURANT }).click();
  await admin.getByRole("link", { name: "New invoice" }).click();
  await admin.getByRole("button", { name: "Create and issue" }).click();
  await admin.waitForURL(/\/admin\/invoices\//);
  await expect(admin.getByText(/INV-\d{4}-\d{5}/).first()).toBeVisible();
  await owner.goto(`/app/${SLUG}/billing`);
  await expect(owner.getByText(/INV-\d{4}-\d{5}/)).toBeVisible();

  // 13. A separate tenant attempts unauthorised access and is denied.
  const other = await newPage(browser);
  await signIn(other, "owner@kampala-grill.test", DEMO_PASSWORD);
  const res = await other.goto(`/app/${SLUG}/orders`);
  expect(res?.status()).toBe(404);
  const api = await other.request.get(`/api/app/${SLUG}/floor?branch=x`);
  expect(api.status()).toBe(404);
  const adminArea = await other.goto("/admin");
  expect(adminArea?.status()).toBe(404);
});
