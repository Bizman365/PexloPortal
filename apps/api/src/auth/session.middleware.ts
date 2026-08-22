import { Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";
import type { AuthenticatedRequest, AuthSession } from "../common";

export const DEFAULT_WORKOS_SESSION_COOKIE = "wos-session";
export const ACTIVE_ORG_COOKIE = "atrium-active-org";
// E2E-only cookie carrying the seeded test user's id. Honored ONLY when
// process.env.E2E_TEST_MODE === "true" (never set in production).
export const E2E_TEST_USER_COOKIE = "e2e-test-user";

// Must match the cookie attributes used when the session is first written in
// auth.controller.ts (COOKIE_OPTIONS), so a refreshed re-seal overwrites the
// same cookie cleanly instead of creating a duplicate.
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  constructor(
    private authService: AuthService,
    private prisma: PrismaService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    const authReq = req as Partial<
      Pick<AuthenticatedRequest, "user" | "session" | "organization" | "member">
    > &
      Request;

    try {
      // E2E test-auth path. STRICTLY gated behind E2E_TEST_MODE, which is never
      // set in production (prod docker-compose lists its env explicitly and does
      // not include this flag). When enabled, a signed-in test user is resolved
      // directly from the DB via the `e2e-test-user` cookie (the user id), with
      // NO WorkOS network call. This decouples the e2e suite from the live auth
      // vendor (deterministic, no accumulating sandbox users, no rate limits).
      if (process.env.E2E_TEST_MODE === "true") {
        const testUserId = req.cookies?.[E2E_TEST_USER_COOKIE];
        if (testUserId) {
          const testUser = await this.prisma.user.findUnique({
            where: { id: testUserId },
          });
          if (testUser) {
            await this.attachUserToRequest(authReq, testUser, testUserId, req);
          }
          return next();
        }
      }

      const cookieName = this.authService.getWorkOSCookieName();
      const sessionData =
        req.cookies?.[cookieName] ?? req.cookies?.[DEFAULT_WORKOS_SESSION_COOKIE];
      if (!sessionData) return next();

      const cookiePassword = this.authService.getWorkOSCookiePassword();
      const sealedSession = this.authService.workos.userManagement.loadSealedSession({
        sessionData,
        cookiePassword,
      });

      // Resolve the WorkOS identity for this request. The access token embedded
      // in the sealed cookie is short-lived (minutes), so authenticate() will
      // start returning `authenticated: false` well before the cookie's own
      // 30-day max-age. When that happens we transparently refresh the session
      // (which rotates the refresh token) and write the new sealed cookie back
      // on the response, so the user stays signed in instead of getting a
      // spurious "Authentication required" until their next full re-login.
      let workosUserId: string;
      let workosEmail: string;
      let sessionId: string;

      const authenticated = await sealedSession.authenticate();
      if (authenticated.authenticated) {
        workosUserId = authenticated.user.id;
        workosEmail = authenticated.user.email;
        sessionId = authenticated.sessionId;
      } else {
        const refreshed = await sealedSession.refresh({ cookiePassword });
        if (!refreshed.authenticated || !refreshed.sealedSession) {
          // Refresh genuinely failed (expired/revoked refresh token, MFA, etc.).
          // Leave req.user unset; AuthGuard rejects and the client re-logs in.
          return next();
        }
        res.cookie(cookieName, refreshed.sealedSession, SESSION_COOKIE_OPTIONS);
        const refreshedUser = refreshed.user ?? refreshed.session?.user;
        if (!refreshedUser) return next();
        workosUserId = refreshedUser.id;
        workosEmail = refreshedUser.email;
        sessionId = refreshed.sessionId;
      }

      const user = await this.prisma.user.findFirst({
        where: {
          OR: [{ workosUserId }, { email: workosEmail }],
        },
      });

      // First WorkOS sign-in before local provisioning: leave req.user unset so
      // AuthGuard rejects. Phase 3 links/provisions Prisma users.
      if (!user) return next();

      await this.attachUserToRequest(authReq, user, sessionId, req);
    } catch {
      // Session resolution failed — continue without auth.
      // The AuthGuard will reject unauthenticated requests.
    }

    next();
  }

  // Shared user/session/org resolution used by both the WorkOS path and the
  // gated E2E test-auth path, so org selection stays identical in both.
  private async attachUserToRequest(
    authReq: Partial<
      Pick<AuthenticatedRequest, "user" | "session" | "organization" | "member">
    > &
      Request,
    user: { id: string; createdAt: Date },
    sessionId: string,
    req: Request,
  ): Promise<void> {
    authReq.user = user as AuthenticatedRequest["user"];
    authReq.session = {
      id: sessionId,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      token: sessionId,
      createdAt: user.createdAt,
      updatedAt: new Date(),
      ipAddress: req.ip ?? null,
      userAgent: req.get("user-agent") ?? null,
      userId: user.id,
      activeOrganizationId: null,
    } satisfies AuthSession;

    const memberships = await this.prisma.member.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      include: {
        organization: {
          include: { members: true },
        },
      },
    });

    if (memberships.length === 0) return;

    const requestedOrgId = req.cookies?.[ACTIVE_ORG_COOKIE];
    const selectedMembership =
      memberships.find(
        (membership) => membership.organizationId === requestedOrgId,
      ) ?? memberships[0];

    authReq.member = selectedMembership;
    authReq.organization = selectedMembership.organization;
    authReq.session.activeOrganizationId = selectedMembership.organizationId;
  }
}
