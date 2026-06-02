import * as Sentry from "@sentry/nestjs";
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { WorkOS } from "@workos-inc/node";
import { PrismaService } from "../prisma/prisma.service";
import { BillingService } from "../billing/billing.service";
import { DEFAULT_STATUSES, DEFAULT_BRANDING } from "@atrium/shared";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private workosClient: WorkOS | null = null;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private billingService: BillingService,
  ) {}

  get workos(): WorkOS {
    if (this.workosClient) return this.workosClient;

    this.workosClient = new WorkOS({
      apiKey: this.config.getOrThrow<string>("WORKOS_API_KEY"),
      clientId: this.config.getOrThrow<string>("WORKOS_CLIENT_ID"),
    });
    return this.workosClient;
  }

  getWorkOS(): WorkOS {
    return this.workos;
  }

  getWorkOSCookiePassword(): string {
    const cookiePassword = this.config.get<string>("WORKOS_COOKIE_PASSWORD");
    if (!cookiePassword || cookiePassword.length < 32) {
      throw new InternalServerErrorException(
        "WORKOS_COOKIE_PASSWORD must be configured and at least 32 characters",
      );
    }
    return cookiePassword;
  }


  getWorkOSCookieName(): string {
    return this.config.get<string>("WORKOS_COOKIE_NAME") || "wos-session";
  }

  /**
   * Seeds default project statuses, branding, system settings, and billing defaults
   * for a new organization. Called by the WorkOS callback/webhook path when a
   * new local organization is created.
   */
  async seedOrganizationDefaults(organizationId: string) {
    await this.prisma.$transaction(async (tx) => {
      for (const status of DEFAULT_STATUSES) {
        await tx.projectStatus.create({
          data: {
            name: status.name,
            slug: status.slug,
            order: status.order,
            color: status.color,
            organizationId,
          },
        });
      }
      await tx.branding.create({
        data: {
          organizationId,
          primaryColor: DEFAULT_BRANDING.primaryColor,
          accentColor: DEFAULT_BRANDING.accentColor,
        },
      });
      await tx.systemSettings.create({
        data: { organizationId },
      });
    });

    try {
      await this.billingService.initializeFreePlan(organizationId);
    } catch (err) {
      Sentry.captureException(err);
      this.logger.error("Failed to initialize free plan", err);
    }
  }

  // Picks the most recently created membership when the user belongs to
  // multiple orgs — used to route auth emails through per-org email config.
  async getPrimaryOrgForUserId(userId: string): Promise<string | undefined> {
    try {
      const member = await this.prisma.member.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      return member?.organizationId;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to resolve primary org for user",
      );
      return undefined;
    }
  }

  async getPrimaryOrgForEmail(email: string): Promise<string | undefined> {
    try {
      const member = await this.prisma.member.findFirst({
        where: { user: { email } },
        orderBy: { createdAt: "desc" },
        select: { organizationId: true },
      });
      return member?.organizationId;
    } catch (err) {
      this.logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "Failed to resolve primary org for email",
      );
      return undefined;
    }
  }

  async generateResetLink(
    email: string,
  ): Promise<{ url: string; emailSent: boolean; emailViaOrgConfig: boolean }> {
    const reset = await this.workos.userManagement.createPasswordReset({ email });
    if (!reset.passwordResetUrl) {
      throw new InternalServerErrorException("Reset URL was not returned by WorkOS");
    }

    return {
      url: reset.passwordResetUrl,
      emailSent: true,
      emailViaOrgConfig: false,
    };
  }

  async verifyPasswordForUser(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      throw new UnauthorizedException("Password verification failed.");
    }

    // E2E seed-auth users are DB-only and intentionally have no WorkOS
    // password. Keep account-deletion tests vendor-decoupled while preserving
    // the same non-empty password requirement enforced by DeleteAccountDto.
    if (process.env.E2E_TEST_MODE === "true" && password.length > 0) {
      return;
    }

    try {
      await this.workos.userManagement.authenticateWithPassword({
        clientId: this.config.getOrThrow<string>("WORKOS_CLIENT_ID"),
        email: user.email,
        password,
      });
    } catch {
      throw new UnauthorizedException("Password verification failed.");
    }
  }
}
