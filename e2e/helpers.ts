// Shared steps for the E2E specs. Each spec builds its own restaurant through the
// real UI so runs never depend on (or disturb) the seeded demo tenants.
import { expect, type Browser, type Page } from "@playwright/test";

export const DEMO_PASSWORD = "ZawliDemo2026";

export function runId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function newPage(browser: Browser) {
  const ctx = await browser.newContext();
  return ctx.newPage();
}

/** Completes a one-time setup link (staff invite, owner first login). */
export async function completeSetup(page: Page, setupUrl: string, password: string) {
  await page.goto(new URL(setupUrl).pathname);
  await page.getByLabel("New password").fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Save password and continue" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/setup-account"));
}

export interface Restaurant {
  admin: Page;
  owner: Page;
  name: string;
  slug: string;
  /** /admin/tenants/<id> */
  adminUrl: string;
  /** /t/<token> for table 1 */
  menuHref: string;
  ownerEmail: string;
  ownerPassword: string;
}

/**
 * Admin creates a restaurant (one branch, "Main"), the owner sets a password and
 * adds a category, one item and table 1, and the admin switches it live.
 */
export async function setUpLiveRestaurant(
  browser: Browser,
  prefix: string,
  item: { name: string; price: string } = { name: "Grilled tilapia", price: "20000" },
): Promise<Restaurant> {
  const run = runId();
  const name = `E2E ${prefix} ${run}`;
  const slug = `e2e-${prefix.toLowerCase()}-${run}`;
  const ownerEmail = `owner-${prefix.toLowerCase()}-${run}@e2e.test`;
  const ownerPassword = "E2eOwnerPass2026";

  const admin = await newPage(browser);
  await signIn(admin, "admin@zawli.test", DEMO_PASSWORD);
  await admin.goto("/admin/tenants/new");
  await admin.getByLabel("Name", { exact: true }).fill(name);
  await admin.getByLabel("Slug").fill(slug);
  await admin.getByLabel("Branch name").fill("Main");
  await admin.getByLabel("Owner name").fill(`Owner ${prefix}`);
  await admin.getByLabel("Owner email").fill(ownerEmail);
  const growth = await admin.locator("#planId option", { hasText: "Growth" }).getAttribute("value");
  await admin.getByLabel("Plan").selectOption(growth!);
  await admin.getByRole("button", { name: "Create restaurant" }).click();
  await expect(admin.getByText("Restaurant created")).toBeVisible();
  const setupUrl = await admin.getByLabel("Owner's first-login link").inputValue();

  const owner = await newPage(browser);
  await completeSetup(owner, setupUrl, ownerPassword);
  await owner.waitForURL(new RegExp(`/app/${slug}`));

  await owner.goto(`/app/${slug}/menu`);
  await owner.getByLabel("Name").fill("Mains");
  await owner.getByRole("button", { name: "Add category" }).click();
  await expect(owner.getByRole("heading", { name: "Mains" })).toBeVisible();
  await owner.getByRole("link", { name: "New item" }).click();
  await owner.waitForURL(/\/menu\/items\/new/);
  await owner.getByLabel("Name").fill(item.name);
  await owner.getByLabel(/^Price/).fill(item.price);
  await owner.getByRole("button", { name: "Create item" }).click();
  await owner.waitForURL(/\/menu\/items\/[^/]+\?created=1/);

  await owner.goto(`/app/${slug}/tables`);
  await owner.getByLabel("Label").fill("1");
  await owner.getByRole("button", { name: "Add table" }).click();
  await expect(owner.getByText("Table 1", { exact: true })).toBeVisible();
  const menuHref = (await owner.getByRole("link", { name: "Open menu" }).first().getAttribute("href"))!;

  await admin.goto("/admin/tenants");
  await admin.getByRole("link", { name }).click();
  await admin.waitForURL(/\/admin\/tenants\/[^/]+$/);
  const adminUrl = new URL(admin.url()).pathname;
  await admin.getByLabel("New status").selectOption("ACTIVE");
  await admin.getByRole("button", { name: "Change status" }).click();
  await expect(admin.getByText("Live", { exact: true }).first()).toBeVisible();

  return { admin, owner, name, slug, adminUrl, menuHref, ownerEmail, ownerPassword };
}

/** Customer on a phone: adds one item from the QR menu and sends the order. Returns the order reference. */
export async function placeOrder(page: Page, menuHref: string, itemName: string, customerName = "Guest") {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(menuHref);
  await page.getByRole("button", { name: new RegExp(itemName) }).click();
  await page.getByRole("button", { name: /Add to order/ }).click();
  await page.getByRole("button", { name: /View order/ }).click();
  await page.getByLabel("Your name (optional)").fill(customerName);
  await page.getByRole("button", { name: /Send order/ }).click();
  await page.waitForURL(/\/orders\//);
  return (await page.getByRole("heading", { name: /Order #/ }).textContent())!.match(/#(\d+)/)![1];
}
