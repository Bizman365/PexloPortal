import { test, expect } from "@playwright/test";
import { seedUser } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";
const DELETE_PASSWORD = "DeleteTest123!";

/**
 * Helper: seed a fresh user, complete setup, and return a logged-in context.
 */
async function createTestUser(
  browser: import("@playwright/test").Browser,
  prefix = "del-test",
) {
  const orgName = `${prefix} Org ${Date.now().toString(36)}`;
  const seeded = await seedUser(browser, {
    role: "owner",
    prefix,
    orgName,
    setupCompleted: true,
  });
  const page = await seeded.context.newPage();

  await page.goto(`${WEB_URL}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  return {
    context: seeded.context,
    page,
    email: seeded.email,
    password: DELETE_PASSWORD,
    orgName,
    orgId: seeded.orgId,
    userId: seeded.userId,
  };
}

async function expectSignedOutRedirect(page: import("@playwright/test").Page) {
  await expect(page).toHaveURL(/\/portal\/sign-in|authkit\.app|workos/i, {
    timeout: 10000,
  });
}

async function fillDeletionConfirm(page: import("@playwright/test").Page) {
  const instruction = await page
    .getByText(/Type DELETE.*to confirm/i)
    .textContent();
  const confirmText =
    instruction?.replace(/^Type\s+/i, "").replace(/\s+to confirm$/i, "") ||
    "DELETE";
  await page.getByRole("textbox").last().fill(confirmText);
}

test.describe("Account Deletion", () => {
  test("owner can delete their account and org, redirected to login", async ({
    browser,
  }) => {
    const { context, page, orgName } = await createTestUser(browser);

    await page.goto(`${WEB_URL}/dashboard/settings/account`);
    await expect(
      page.getByRole("heading", { name: /^profile$/i }).first(),
    ).toBeVisible({ timeout: 10000 });

    // Verify the Danger Zone section is visible (owner only)
    await expect(page.getByText("Danger Zone")).toBeVisible();

    // Enter password to enable the delete button
    await page.getByPlaceholder("Your current password").fill(DELETE_PASSWORD);

    // Click delete account button
    await page.getByRole("button", { name: /delete account/i }).click();

    // Confirmation dialog should appear with org name
    await expect(page.getByText("This will permanently delete")).toBeVisible();
    await expect(page.getByText(orgName, { exact: true }).first()).toBeVisible();

    // Type the exact confirmation phrase shown by the dialog.
    await fillDeletionConfirm(page);

    // Click the confirm button in the dialog
    await page.getByRole("button", { name: /delete account/i }).last().click();

    // Should redirect to the canonical WorkOS sign-in route after deletion.
    await expectSignedOutRedirect(page);

    await context.close();
  });

  test("deleted user cannot authenticate again with stale e2e cookie", async ({ browser }) => {
    const { context, page, userId } = await createTestUser(browser);

    // Delete the account via UI
    await page.goto(`${WEB_URL}/dashboard/settings/account`);
    await expect(page.getByText("Danger Zone")).toBeVisible({ timeout: 10000 });
    await page.getByPlaceholder("Your current password").fill(DELETE_PASSWORD);
    await page.getByRole("button", { name: /delete account/i }).click();
    await expect(page.getByText("This will permanently delete")).toBeVisible();
    await fillDeletionConfirm(page);
    await page.getByRole("button", { name: /delete account/i }).last().click();
    await expectSignedOutRedirect(page);
    await context.close();

    // Better Auth login pages were removed. Verify the deleted user's old
    // e2e auth cookie no longer resolves to an authenticated API session.
    const newContext = await browser.newContext({ storageState: undefined });
    await newContext.addCookies([
      {
        name: "e2e-test-user",
        value: userId,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    const sessionRes = await newContext.request.get(
      `${API_URL}/api/auth/get-session`,
    );
    expect(sessionRes.status()).toBe(200);
    expect(await sessionRes.text()).toMatch(/^$|^null$/);

    const guardedRes = await newContext.request.get(
      `${API_URL}/api/account/deletion-info`,
    );
    expect(guardedRes.status()).toBe(401);

    await newContext.close();
  });

  test("non-owner sees danger zone with non-owner messaging", async ({
    browser,
  }) => {
    // Create user A (the owner)
    const { context: ctxA, orgId } = await createTestUser(
      browser,
      "owner-vis",
    );

    // Seed user B as a member in the same org (no dead invite/signup flow).
    const member = await seedUser(browser, {
      role: "member",
      prefix: "owner-vis-member",
      orgId,
    });
    const ctxB = member.context;
    const pageB = await ctxB.newPage();

    // Navigate to portal settings — non-owner should see delete account section
    await pageB.goto(`${WEB_URL}/portal/settings`);
    await expect(
      pageB.getByRole("heading", { name: /account settings/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByRole("heading", { name: "Delete Account" })).toBeVisible();
    await expect(pageB.getByText("Permanently delete your account and remove your access")).toBeVisible();

    await ctxA.close();
    await ctxB.close();
  });
});
