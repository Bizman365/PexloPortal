import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { PrismaClient } from "../packages/database/src";

/**
 * Global setup — deterministic, vendor-decoupled e2e auth bootstrap.
 *
 * Instead of calling the live WorkOS signup flow (which requires real WorkOS
 * credentials, accumulates sandbox users, and is subject to rate limits /
 * vendor downtime), we seed an owner user + organization + membership directly
 * into the test database and authenticate via the gated E2E test-auth path in
 * SessionMiddleware (honored ONLY when E2E_TEST_MODE === "true", which is never
 * set in production).
 *
 * The resulting storageState carries two cookies:
 *   - `e2e-test-user`: the seeded user's id (resolved by SessionMiddleware)
 *   - `csrf-token`:     a token matching the cookie, so write requests pass the
 *                       CSRF guard (tests send it back via x-csrf-token).
 *
 * Requires E2E_TEST_MODE=true on the API process (set in CI for the Playwright
 * step and in the dev webServer command).
 */
async function globalSetup() {
  const apiUrl = "http://localhost:3001";
  const prisma = new PrismaClient();

  try {
    // Stable identities so re-runs against a persistent DB are idempotent.
    const userId = randomUUID();
    const orgId = randomUUID();
    const email = `e2e-${Date.now()}@test.local`;

    const org = await prisma.organization.create({
      data: {
        id: orgId,
        name: "E2E Test Org",
        slug: `e2e-test-org-${randomBytes(3).toString("hex")}`,
        setupCompleted: true,
      },
    });

    const user = await prisma.user.create({
      data: {
        id: userId,
        name: "E2E Test User",
        email,
        emailVerified: true,
        // workosUserId intentionally null — the e2e path never touches WorkOS.
      },
    });

    await prisma.member.create({
      data: {
        id: randomUUID(),
        organizationId: org.id,
        userId: user.id,
        role: "owner",
      },
    });

    // Mint a CSRF token and inject both cookies into a fresh browser context,
    // then persist the storage state all tests reuse.
    const csrfToken = randomBytes(32).toString("hex");
    const browser = await chromium.launch();
    const context = await browser.newContext();

    await context.addCookies([
      {
        name: "e2e-test-user",
        value: user.id,
        domain: "localhost",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
      {
        name: "csrf-token",
        value: csrfToken,
        domain: "localhost",
        path: "/",
        sameSite: "Lax",
      },
    ]);

    // Sanity check: confirm the seeded session authenticates end-to-end before
    // committing storage state, so a misconfigured E2E_TEST_MODE fails loudly
    // here instead of in every downstream test.
    const page = await context.newPage();
    const check = await page.request.get(`${apiUrl}/api/projects?limit=1`);
    if (check.status() === 401) {
      throw new Error(
        "E2E auth bootstrap failed: seeded session was rejected (401). " +
          "Ensure the API process has E2E_TEST_MODE=true.",
      );
    }

    const authDir = resolve(__dirname, ".auth");
    mkdirSync(authDir, { recursive: true });
    await context.storageState({ path: resolve(authDir, "user.json") });
    await browser.close();
  } finally {
    await prisma.$disconnect();
  }
}

export default globalSetup;
