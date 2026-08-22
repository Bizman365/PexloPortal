import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { randomBytes, randomUUID } from "node:crypto";
import type {
  APIRequestContext,
  BrowserContext,
  Browser,
} from "@playwright/test";
import { PrismaClient } from "../../packages/database/src";

const API = "http://localhost:3001/api";

// Single shared Prisma client for e2e seeding (vendor-decoupled auth).
let _prisma: PrismaClient | null = null;
function prisma(): PrismaClient {
  if (!_prisma) _prisma = new PrismaClient();
  return _prisma;
}

export interface SeededUser {
  context: BrowserContext;
  userId: string;
  orgId: string;
  email: string;
  csrfToken: string;
}

/**
 * Seed a user + organization + membership directly into the test DB and return
 * an authenticated browser context (carrying the gated `e2e-test-user` cookie
 * + a matching `csrf-token`). No WorkOS call — the API resolves this user via
 * the E2E_TEST_MODE path in SessionMiddleware.
 *
 * Use this instead of the removed Better Auth signup/invite endpoints. Pass an
 * existing `orgId` to add a second member (e.g. a client) to the same org.
 */
export async function seedUser(
  browser: Browser,
  opts: {
    role?: string;
    prefix?: string;
    orgId?: string;
    orgName?: string;
    setupCompleted?: boolean;
    name?: string;
  } = {},
): Promise<SeededUser> {
  const db = prisma();
  const role = opts.role ?? "owner";
  const prefix = opts.prefix ?? "e2e";
  const email = `${prefix}-${Date.now()}-${randomBytes(2).toString("hex")}@test.local`;

  let orgId = opts.orgId;
  if (!orgId) {
    const org = await db.organization.create({
      data: {
        id: randomUUID(),
        name: opts.orgName ?? `${prefix} Org`,
        slug: `${prefix}-org-${randomBytes(3).toString("hex")}`,
        setupCompleted: opts.setupCompleted ?? true,
      },
    });
    orgId = org.id;
  }

  const user = await db.user.create({
    data: {
      id: randomUUID(),
      name: opts.name ?? `${prefix} user`,
      email,
      emailVerified: true,
    },
  });

  await db.member.create({
    data: {
      id: randomUUID(),
      organizationId: orgId,
      userId: user.id,
      role,
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

  return { context, userId: user.id, orgId, email, csrfToken };
}

/** Disconnect the shared seed Prisma client (call in a global teardown if needed). */
export async function closeSeedClient(): Promise<void> {
  if (_prisma) {
    await _prisma.$disconnect();
    _prisma = null;
  }
}

/**
 * Read the CSRF token from the stored auth state file written by global-setup.
 * This is used by tests that make API calls via the `request` fixture (which
 * carries cookies from stored state but does NOT automatically set the
 * x-csrf-token header).
 */
export function getCsrfToken(): string {
  // The global-setup writes to "e2e/.auth/user.json" (relative to repo root).
  // Depending on cwd, the file could be at either of these paths.
  const candidates = [
    resolve(__dirname, "../.auth/user.json"),
    resolve(__dirname, "../e2e/.auth/user.json"),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      const state = JSON.parse(readFileSync(p, "utf-8"));
      const cookie = state.cookies?.find(
        (c: { name: string }) => c.name === "csrf-token",
      );
      return cookie?.value || "";
    }
  }

  return "";
}

/**
 * Read the CSRF token from a live browser context's cookies.
 * Use this for tests that create fresh contexts (e.g. browser.newContext())
 * where the stored auth state is not applicable.
 */
export async function getCsrfTokenFromContext(
  context: BrowserContext,
): Promise<string> {
  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === "csrf-token");
  return cookie?.value || "";
}

/**
 * Get or create a project by name. The Free plan caps orgs at 2 projects, so
 * tests must reuse projects by name when possible.
 */
export async function getOrCreateProject(
  request: APIRequestContext,
  name: string,
): Promise<string> {
  const listRes = await request.get(`${API}/projects?limit=100`);
  if (listRes.ok()) {
    const list = await listRes.json();
    const items: { id: string; name: string }[] = Array.isArray(list)
      ? list
      : (list.data ?? []);
    const found = items.find((p) => p.name === name);
    if (found) return found.id;
  }
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/projects`, {
    data: { name },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create project (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}

export async function createTask(
  request: APIRequestContext,
  projectId: string,
  title: string,
  dueDate: Date,
): Promise<string> {
  const csrfToken = getCsrfToken();
  const res = await request.post(`${API}/tasks?projectId=${projectId}`, {
    data: { title, dueDate: dueDate.toISOString() },
    headers: { "x-csrf-token": csrfToken },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Failed to create task (${res.status()}): ${body.slice(0, 200)}`,
    );
  }
  const body = await res.json();
  return body.id as string;
}
