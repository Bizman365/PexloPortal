import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { closeSeedClient, seedUser } from "./tests/helpers";

/**
 * Global setup — deterministic, vendor-decoupled e2e auth bootstrap.
 *
 * The WorkOS migration removed the old Better Auth password flow, so the e2e
 * suite must not call dead auth endpoints or mint fake WorkOS sessions. Match the
 * current post-WorkOS e2e pattern instead: seed a user + organization +
 * membership directly into the isolated test DB, then authenticate through the
 * gated E2E test-auth path in SessionMiddleware.
 *
 * The resulting storageState carries two cookies:
 *   - `e2e-test-user`: the seeded user's id (resolved by SessionMiddleware)
 *   - `csrf-token`:     a token matching the cookie, so write requests pass the
 *                       CSRF guard (tests send it back via x-csrf-token).
 *
 * Requires E2E_TEST_MODE=true on the API process (set in CI for the Playwright
 * step and in the dev webServer command). This flag is never set in production.
 */
async function globalSetup() {
  const apiUrl = "http://localhost:3001";
  const browser = await chromium.launch();

  try {
    const seeded = await seedUser(browser, {
      role: "owner",
      prefix: "global-setup",
      orgName: "E2E Test Org",
      setupCompleted: true,
      name: "E2E Test User",
    });

    // Sanity check: confirm the seeded session authenticates end-to-end before
    // committing storage state, so a misconfigured E2E_TEST_MODE fails loudly
    // here instead of in every downstream test.
    const page = await seeded.context.newPage();
    const check = await page.request.get(`${apiUrl}/api/projects?limit=1`);
    if (check.status() === 401) {
      throw new Error(
        "E2E auth bootstrap failed: seeded session was rejected (401). " +
          "Ensure the API process has E2E_TEST_MODE=true.",
      );
    }

    const authDir = resolve(__dirname, ".auth");
    mkdirSync(authDir, { recursive: true });
    await seeded.context.storageState({ path: resolve(authDir, "user.json") });
    await seeded.context.close();
  } finally {
    await browser.close();
    await closeSeedClient();
  }
}

export default globalSetup;
