// Staff screen: invite, setup links, access changes, deactivate/reactivate, and
// what an invited waiter can reach.
import { expect, test } from "@playwright/test";
import { completeSetup, newPage, setUpLiveRestaurant } from "./helpers";

test("owner invites a waiter, changes access, reissues the link; waiter sees only the floor", async ({ browser }) => {
  test.setTimeout(600_000); // building the restaurant through the UI is slow on small machines
  const r = await setUpLiveRestaurant(browser, "Staff");
  const { owner, slug } = r;
  owner.on("dialog", (d) => d.accept());

  // A second branch so access can be changed.
  await owner.goto(`/app/${slug}/branches`);
  await owner.locator("#new-branch-name").fill("Riverside");
  await owner.locator("#new-branch-slug").fill("riverside");
  await owner.getByRole("button", { name: "Create branch" }).click();
  await expect(owner.getByRole("heading", { name: /Riverside/ })).toBeVisible();

  // Invite a waiter for Main only; a one-time setup link appears.
  const waiterEmail = `waiter-${slug}@e2e.test`;
  await owner.goto(`/app/${slug}/staff`);
  await owner.getByLabel("Full name").fill("Wanda Waiter");
  await owner.getByLabel("Email").fill(waiterEmail);
  await owner.getByLabel("Role").selectOption("WAITER");
  await owner.getByRole("checkbox", { name: "Main" }).check();
  await owner.getByRole("button", { name: "Add staff member" }).click();
  const firstLink = await owner.getByLabel(/^Setup link/).inputValue();
  expect(firstLink).toContain("/setup-account/");
  await expect(owner.getByLabel("Full name")).toHaveValue(""); // form cleared for the next invite

  const row = owner.locator("li", { hasText: waiterEmail });
  await expect(row.getByText("Setup pending")).toBeVisible();
  await expect(row.getByText(/^Main ·/)).toBeVisible();

  // Change access: add Riverside.
  await row.getByText("Change access").click();
  await row.getByRole("checkbox", { name: "Riverside" }).check();
  await row.getByRole("button", { name: "Save access" }).click();
  // The inline "Saved" note only shows for a few seconds; check the stored result instead.
  await expect(async () => {
    await owner.reload();
    await expect(owner.locator("li", { hasText: waiterEmail }).getByText(/Main, Riverside/)).toBeVisible({
      timeout: 5_000,
    });
  }).toPass({ timeout: 60_000 });

  // Reissue the setup link: the old one stops working.
  await owner.locator("li", { hasText: waiterEmail }).getByRole("button", { name: "New setup link" }).click();
  const secondLink = await owner.getByLabel("New setup link").inputValue();
  expect(secondLink).toContain("/setup-account/");
  expect(secondLink).not.toBe(firstLink);

  const waiter = await newPage(browser);
  await waiter.goto(new URL(firstLink).pathname);
  await expect(waiter.getByText("This link has expired")).toBeVisible();

  // The waiter completes setup and lands on the floor screen.
  await completeSetup(waiter, secondLink, "E2eWaiterPass2026");
  await waiter.waitForURL(new RegExp(`/app/${slug}/floor`));
  for (const path of ["staff", "settings", "branches", "billing"]) {
    const res = await waiter.goto(`/app/${slug}/${path}`);
    expect(res?.status(), `/${path} should be hidden from a waiter`).toBe(404);
  }
  // Waiters may read the menu (to answer guests) but not edit it.
  await waiter.goto(`/app/${slug}/menu`);
  await expect(waiter.getByRole("heading", { name: "Menu", exact: true })).toBeVisible();
  await expect(waiter.getByRole("button", { name: "Add category" })).toHaveCount(0);
  await expect(waiter.getByRole("link", { name: "New item" })).toHaveCount(0);
  const floor = await waiter.goto(`/app/${slug}/floor`);
  expect(floor?.status()).toBe(200);

  await owner.reload();
  await expect(owner.locator("li", { hasText: waiterEmail }).getByText("Setup pending")).toHaveCount(0);

  // Deactivate: the waiter loses access immediately; reactivate restores it.
  await owner.locator("li", { hasText: waiterEmail }).getByRole("button", { name: "Deactivate" }).click();
  await expect(owner.locator("li", { hasText: waiterEmail }).getByText("Deactivated")).toBeVisible();
  const blocked = await waiter.goto(`/app/${slug}/floor`);
  expect(blocked?.status()).toBe(404);

  await owner.locator("li", { hasText: waiterEmail }).getByRole("button", { name: "Reactivate" }).click();
  await expect(owner.locator("li", { hasText: waiterEmail }).getByText("Deactivated")).toHaveCount(0);
  const back = await waiter.goto(`/app/${slug}/floor`);
  expect(back?.status()).toBe(200);
});
