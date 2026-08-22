import { test, expect } from "@playwright/test";
import { seedUser } from "./helpers";

test.describe("Projects", () => {
  // These tests require a running backend with seeded data
  // They will be fully functional once auth flow is integrated

  test("dashboard projects page loads", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(page.getByRole("heading", { name: /projects/i })).toBeVisible();
  });

  test("new project button exists", async ({ page }) => {
    await page.goto("/dashboard/projects");
    await expect(
      page.getByRole("button", { name: /new project/i }),
    ).toBeVisible();
  });

  test("portal projects page loads", async ({ browser }) => {
    const member = await seedUser(browser, {
      role: "member",
      prefix: "projects-portal-member",
    });
    const page = await member.context.newPage();
    await page.goto("/portal/projects");
    await expect(
      page.getByRole("heading", { name: /your projects/i }),
    ).toBeVisible();
    await member.context.close();
  });
});
