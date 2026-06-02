import { test, expect } from "@playwright/test";
import { seedUser } from "./helpers";

test.describe("Portal", () => {
  test("portal home redirects to projects", async ({ browser }) => {
    const member = await seedUser(browser, { role: "member", prefix: "portal-member" });
    const page = await member.context.newPage();
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/projects/, { timeout: 10000 });
    await member.context.close();
  });

  test("portal projects page has header with navigation", async ({ browser }) => {
    const member = await seedUser(browser, { role: "member", prefix: "portal-header" });
    const page = await member.context.newPage();
    await page.goto("/portal");
    await expect(page).toHaveURL(/\/portal\/projects/, { timeout: 10000 });
    await expect(page.getByText(/projects/i).first()).toBeVisible();
    await member.context.close();
  });
});
