import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { getCsrfTokenFromContext, seedUser } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

async function createOwner(browser: Browser, prefix = "vac-owner"): Promise<{
  context: import("@playwright/test").BrowserContext;
  page: Page;
  email: string;
  orgId: string;
}> {
  const seeded = await seedUser(browser, { role: "owner", prefix });
  const page = await seeded.context.newPage();

  await page.goto(`${WEB_URL}/dashboard`, {
    waitUntil: "networkidle",
    timeout: 15000,
  });

  return {
    context: seeded.context,
    page,
    email: seeded.email,
    orgId: seeded.orgId,
  };
}

async function seedClientAndAssignProject(
  browser: Browser,
  ownerPage: Page,
  ownerOrgId: string,
  prefix: string,
): Promise<{ clientEmail: string; clientName: string; clientUserId: string }> {
  const client = await seedUser(browser, {
    role: "member",
    prefix,
    orgId: ownerOrgId,
  });
  const clientName = `${prefix} user`;
  const ownerCsrf = await getCsrfTokenFromContext(ownerPage.context());

  const projectRes = await ownerPage.request.post(`${API_URL}/api/projects`, {
    data: { name: `${prefix} Project ${Date.now()}` },
    headers: { "x-csrf-token": ownerCsrf },
  });
  expect(projectRes.ok()).toBeTruthy();
  const project = await projectRes.json();

  const assignRes = await ownerPage.request.put(
    `${API_URL}/api/projects/${project.id}`,
    {
      data: { clientUserIds: [client.userId] },
      headers: {
        "x-csrf-token": ownerCsrf,
        "Content-Type": "application/json",
      },
    },
  );
  expect(assignRes.ok()).toBeTruthy();

  await client.context.close();

  return {
    clientEmail: client.email,
    clientName,
    clientUserId: client.userId,
  };
}

test.describe("View as customer", () => {
  test.setTimeout(120000);
  test("owner can preview portal as a client and mutations are blocked", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage, orgId } =
      await createOwner(browser);
    const { clientEmail, clientName } = await seedClientAndAssignProject(
      browser,
      ownerPage,
      orgId,
      "vac-client",
    );

    await ownerPage.goto(`${WEB_URL}/dashboard/clients`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await ownerPage.getByRole("button", { name: /^clients/i }).click();

    const clientRow = ownerPage
      .locator("div")
      .filter({ hasText: clientEmail })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10000 });

    const viewButton = clientRow.getByTitle("View as customer");
    await expect(viewButton).toBeVisible();

    const [previewPage] = await Promise.all([
      ownerCtx.waitForEvent("page"),
      viewButton.click(),
    ]);

    await previewPage.waitForLoadState("networkidle");
    await previewPage.waitForURL(/\/portal/, { timeout: 15000 });

    await expect(previewPage.getByText(/previewing as/i)).toBeVisible({
      timeout: 10000,
    });
    await expect(previewPage.getByText(clientName)).toBeVisible();
    await expect(previewPage.getByText(/read-only/i)).toBeVisible();
    await expect(
      previewPage.getByRole("button", { name: /exit preview/i }),
    ).toBeVisible();

    const mutationResult = await previewPage.evaluate(async () => {
      try {
        const res = await fetch("http://localhost:3001/api/clients/me/profile", {
          method: "PUT",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-Preview-As": JSON.parse(
              window.sessionStorage.getItem("atrium:previewAs") || "{}",
            ).clientId || "",
          },
          body: JSON.stringify({ company: "should-not-save" }),
        });
        return { ok: res.ok, status: res.status };
      } catch (err) {
        return { error: String(err), ok: false, status: 0 };
      }
    });
    expect(mutationResult.ok).not.toBe(true);
    expect([401, 403]).toContain(mutationResult.status);

    await previewPage.getByRole("button", { name: /exit preview/i }).click();
    await previewPage
      .waitForURL(/\/dashboard\/clients/, { timeout: 5000 })
      .catch(() => {
        // Tab may have closed via window.close() instead of navigating.
      });

    await ownerCtx.close();
  });

  test("query params are stripped from URL after preview mode initializes", async ({
    browser,
  }) => {
    const { context: ownerCtx, page: ownerPage, orgId } = await createOwner(
      browser,
      "vac-strip",
    );
    const { clientEmail } = await seedClientAndAssignProject(
      browser,
      ownerPage,
      orgId,
      "vac-strip-client",
    );

    await ownerPage.goto(`${WEB_URL}/dashboard/clients`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });
    await ownerPage.getByRole("button", { name: /^clients/i }).click();

    const clientRow = ownerPage
      .locator("div")
      .filter({ hasText: clientEmail })
      .first();
    await expect(clientRow).toBeVisible({ timeout: 10000 });

    const viewButton = clientRow.getByTitle("View as customer");
    const [previewPage] = await Promise.all([
      ownerCtx.waitForEvent("page"),
      viewButton.click(),
    ]);

    await previewPage.waitForLoadState("networkidle");
    // After replaceState the URL must contain no previewAs/previewName/previewEmail
    // query params. The portal may internally redirect /portal -> /portal/projects.
    await expect(previewPage).toHaveURL(
      /^http:\/\/localhost:3000\/portal(\/.*)?$/,
      { timeout: 10000 },
    );
    expect(new URL(previewPage.url()).search).toBe("");

    await ownerCtx.close();
  });

  test("banner shows fallback name 'Client' when previewName param is absent", async ({
    browser,
  }) => {
    // Navigate directly to /portal?previewAs=<id> without previewName/previewEmail.
    // The provider must fall back to "Client" / "" instead of crashing.
    const { context: ownerCtx, page: ownerPage, orgId } = await createOwner(
      browser,
      "vac-fallback",
    );
    await seedClientAndAssignProject(
      browser,
      ownerPage,
      orgId,
      "vac-fallback-client",
    );

    // Fetch the client's userId directly via the API so we can craft the URL.
    const membersRes = await ownerPage.request.get(
      `${API_URL}/api/clients?page=1&limit=100`,
      { headers: { Origin: WEB_URL } },
    );
    const membersBody = await membersRes.json();
    const clientMember = (membersBody.data as Array<{
      role: string;
      userId: string;
    }>).find((m) => m.role === "member");

    if (!clientMember) {
      throw new Error("Could not find a member-role member to preview as");
    }

    // Open /portal/projects with only previewAs — deliberately omit previewName/previewEmail.
    const portalPage = await ownerCtx.newPage();
    await portalPage.goto(
      `${WEB_URL}/portal/projects?previewAs=${clientMember.userId}`,
      { waitUntil: "networkidle", timeout: 20000 },
    );

    await expect(portalPage.getByText(/previewing as/i)).toBeVisible({
      timeout: 10000,
    });
    // Fallback name must render as "Client", not throw or show undefined/null.
    await expect(portalPage.getByText("Client", { exact: true })).toBeVisible();

    await ownerCtx.close();
  });
});
