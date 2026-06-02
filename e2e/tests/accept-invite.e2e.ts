import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { PrismaClient } from "../../packages/database/src";
import { seedUser } from "./helpers";

const API_URL = "http://localhost:3001";
const WEB_URL = "http://localhost:3000";

const prisma = new PrismaClient();

async function inviteClient(
  ownerPage: import("@playwright/test").Page,
  csrfToken: string,
  clientEmail: string,
  role = "member",
) {
  const inviteRes = await ownerPage.request.post(
    `${API_URL}/api/clients/invitations`,
    {
      data: { email: clientEmail, role },
      headers: { Origin: WEB_URL, "x-csrf-token": csrfToken },
    },
  );

  if (!inviteRes.ok()) {
    const body = await inviteRes.text();
    throw new Error(`Invite failed (${inviteRes.status()}): ${body}`);
  }

  const inviteData: { id?: string; inviteLink?: string } = await inviteRes.json();
  if (!inviteData.id) {
    throw new Error(`No invitation ID returned: ${JSON.stringify(inviteData)}`);
  }

  return inviteData as { id: string; inviteLink: string };
}

async function createInviteeContext(
  browser: import("@playwright/test").Browser,
  email: string,
) {
  const user = await prisma.user.create({
    data: {
      id: randomUUID(),
      name: "Invited Client",
      email,
      emailVerified: true,
    },
  });
  const csrfToken = randomBytes(32).toString("hex");
  const context = await browser.newContext({ storageState: undefined });
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
  return { context, userId: user.id, csrfToken };
}

test.describe("Accept Invite", () => {
  test.afterAll(async () => {
    await prisma.$disconnect();
  });

  test("new invitee sees invite details and is routed through WorkOS AuthKit", async ({
    browser,
  }) => {
    const owner = await seedUser(browser, { prefix: "inv-new", role: "owner" });
    const ownerPage = await owner.context.newPage();
    const clientEmail = `inv-client-${Date.now()}-${randomBytes(2).toString("hex")}@test.local`;
    const invitation = await inviteClient(ownerPage, owner.csrfToken, clientEmail);
    await owner.context.close();

    const clientCtx = await browser.newContext({ storageState: undefined });
    const clientPage = await clientCtx.newPage();

    await clientPage.goto(`${WEB_URL}/accept-invite?id=${invitation.id}`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    await expect(
      clientPage.getByRole("heading", { name: /join inv-new org/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(clientPage.getByText(clientEmail, { exact: true })).toBeVisible();

    const cta = clientPage.getByRole("link", { name: /continue with workos/i });
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute("href");
    expect(href).toContain("/portal/sign-in?");
    expect(decodeURIComponent(href ?? "")).toContain(
      `/accept-invite/complete?id=${invitation.id}`,
    );
    expect(decodeURIComponent(href ?? "")).toContain(`loginHint=${clientEmail}`);

    await clientCtx.close();
  });

  test("existing account accepts invite from WorkOS return path and lands on portal", async ({
    browser,
  }) => {
    const owner = await seedUser(browser, { prefix: "inv-existing", role: "owner" });
    const ownerPage = await owner.context.newPage();
    const clientEmail = `inv-existing-client-${Date.now()}-${randomBytes(2).toString("hex")}@test.local`;
    const invitation = await inviteClient(ownerPage, owner.csrfToken, clientEmail);
    await owner.context.close();

    const invitee = await createInviteeContext(browser, clientEmail);
    const clientPage = await invitee.context.newPage();

    await clientPage.goto(`${WEB_URL}/accept-invite/complete?id=${invitation.id}`, {
      waitUntil: "networkidle",
      timeout: 20000,
    });

    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });

    const persistedInvite = await prisma.invitation.findUnique({
      where: { id: invitation.id },
    });
    expect(persistedInvite?.status).toBe("accepted");

    const member = await prisma.member.findFirst({
      where: {
        userId: invitee.userId,
        organizationId: owner.orgId,
        role: "member",
      },
    });
    expect(member).toBeTruthy();

    await invitee.context.close();
  });

  test("invitee who owns another org lands on portal for the invited org, not setup", async ({
    browser,
  }) => {
    const inviter = await seedUser(browser, {
      prefix: "inv-multi-inviter",
      role: "owner",
    });
    const inviterPage = await inviter.context.newPage();

    const invitee = await seedUser(browser, {
      prefix: "inv-multi",
      role: "owner",
      setupCompleted: false,
    });

    const invitation = await inviteClient(
      inviterPage,
      inviter.csrfToken,
      invitee.email,
    );
    await inviter.context.close();

    const clientPage = await invitee.context.newPage();
    await clientPage.goto(`${WEB_URL}/accept-invite/complete?id=${invitation.id}`, {
      waitUntil: "networkidle",
      timeout: 20000,
    });

    await expect(clientPage).toHaveURL(/\/portal/, { timeout: 20000 });
    expect(clientPage.url()).not.toMatch(/\/dashboard/);
    expect(clientPage.url()).not.toMatch(/\/setup/);

    const member = await prisma.member.findFirst({
      where: {
        userId: invitee.userId,
        organizationId: inviter.orgId,
        role: "member",
      },
    });
    expect(member).toBeTruthy();

    await invitee.context.close();
  });

  test("shows invalid invitation message when no ID is provided", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto(`${WEB_URL}/accept-invite`, {
      waitUntil: "networkidle",
      timeout: 15000,
    });

    await expect(
      page.getByRole("heading", { name: /invalid invitation/i }),
    ).toBeVisible({ timeout: 10000 });
    await expect(
      page.getByText(/this invitation link is missing or invalid/i),
    ).toBeVisible();

    await context.close();
  });
});
