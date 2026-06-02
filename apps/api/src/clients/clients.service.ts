import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import {
  ACTIVE_ORG_COOKIE,
  DEFAULT_WORKOS_SESSION_COOKIE,
} from "../auth/session.middleware";
import type { AuthenticatedRequest } from "../common";
import { UpdateClientProfileDto } from "./client-profile.dto";
import { CreateInvitationDto } from "./clients.dto";

const ACTIVE_ORG_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 30 * 24 * 60 * 60 * 1000,
};

type WorkOSSessionUser = {
  id: string;
  email: string;
  emailVerified?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  profilePictureUrl?: string | null;
};

type InvitationRequest = Request & Partial<Pick<AuthenticatedRequest, "user">>;

@Injectable()
export class ClientsService {
  constructor(
    private prisma: PrismaService,
    private authService: AuthService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private displayNameFromWorkOS(user: WorkOSSessionUser): string {
    const fullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();
    return fullName || user.email.split("@")[0] || user.email;
  }

  private async resolveAuthenticatedInviteUser(
    req: InvitationRequest,
    res: Response,
  ): Promise<{
    id?: string;
    email: string;
    name: string;
    emailVerified: boolean;
    image?: string | null;
    workosUserId?: string | null;
  }> {
    if (req.user?.id) {
      const localUser = await this.prisma.user.findUnique({
        where: { id: req.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          emailVerified: true,
          image: true,
          workosUserId: true,
        },
      });
      if (localUser) return localUser;
    }

    const cookieName = this.authService.getWorkOSCookieName();
    const sessionData =
      req.cookies?.[cookieName] ?? req.cookies?.[DEFAULT_WORKOS_SESSION_COOKIE];
    if (!sessionData) {
      throw new UnauthorizedException(
        "Authenticate with WorkOS before accepting this invitation",
      );
    }

    const cookiePassword = this.authService.getWorkOSCookiePassword();
    const sealedSession =
      this.authService.workos.userManagement.loadSealedSession({
        sessionData,
        cookiePassword,
      });

    const authenticated = await sealedSession.authenticate();
    if (authenticated.authenticated) {
      const user = authenticated.user as WorkOSSessionUser;
      return {
        email: this.normalizeEmail(user.email),
        name: this.displayNameFromWorkOS(user),
        emailVerified: user.emailVerified ?? false,
        image: user.profilePictureUrl,
        workosUserId: user.id,
      };
    }

    const refreshed = await sealedSession.refresh({ cookiePassword });
    if (!refreshed.authenticated || !refreshed.sealedSession) {
      throw new UnauthorizedException(
        "WorkOS session expired. Please sign in again.",
      );
    }

    res.cookie(cookieName, refreshed.sealedSession, ACTIVE_ORG_COOKIE_OPTIONS);
    const refreshedUser = (refreshed.user ?? refreshed.session?.user) as
      | WorkOSSessionUser
      | undefined;
    if (!refreshedUser) {
      throw new UnauthorizedException("WorkOS session did not include a user");
    }

    return {
      email: this.normalizeEmail(refreshedUser.email),
      name: this.displayNameFromWorkOS(refreshedUser),
      emailVerified: refreshedUser.emailVerified ?? false,
      image: refreshedUser.profilePictureUrl,
      workosUserId: refreshedUser.id,
    };
  }

  async createInvitation(
    orgId: string,
    inviterId: string,
    dto: CreateInvitationDto,
  ) {
    const email = this.normalizeEmail(dto.email);
    const role = dto.role ?? "member";

    const existingUser = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" as const } },
      select: {
        id: true,
        members: {
          where: { organizationId: orgId },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (existingUser?.members.length) {
      throw new BadRequestException(
        "This user is already a member of this organization",
      );
    }

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    return this.prisma.invitation.create({
      data: {
        id: randomUUID(),
        organizationId: orgId,
        email,
        role,
        status: "pending",
        expiresAt,
        inviterId,
      },
    });
  }

  async getPublicInvitation(invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { organization: { select: { name: true } } },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");

    const effectiveStatus =
      invitation.status === "pending" &&
      invitation.expiresAt.getTime() <= Date.now()
        ? "expired"
        : invitation.status;

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role ?? "member",
      status: effectiveStatus,
      expiresAt: invitation.expiresAt,
      organizationName: invitation.organization.name,
    };
  }

  async acceptInvitation(
    invitationId: string,
    req: InvitationRequest,
    res: Response,
  ) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: { organization: { select: { id: true, name: true } } },
    });
    if (!invitation) throw new NotFoundException("Invitation not found");

    const authenticatedUser = await this.resolveAuthenticatedInviteUser(
      req,
      res,
    );
    const authenticatedEmail = this.normalizeEmail(authenticatedUser.email);
    const invitationEmail = this.normalizeEmail(invitation.email);
    if (authenticatedEmail !== invitationEmail) {
      throw new ForbiddenException(
        "Sign in with the email address this invitation was sent to",
      );
    }

    if (
      invitation.status === "pending" &&
      invitation.expiresAt.getTime() <= Date.now()
    ) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: "expired" },
      });
      throw new BadRequestException("Invitation has expired");
    }

    if (invitation.status !== "pending") {
      const localUser = authenticatedUser.id
        ? await this.prisma.user.findUnique({
            where: { id: authenticatedUser.id },
          })
        : await this.prisma.user.findFirst({
            where: {
              OR: [
                ...(authenticatedUser.workosUserId
                  ? [{ workosUserId: authenticatedUser.workosUserId }]
                  : []),
                {
                  email: {
                    equals: authenticatedEmail,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          });
      if (invitation.status === "accepted" && localUser) {
        const existingMember = await this.prisma.member.findFirst({
          where: {
            organizationId: invitation.organizationId,
            userId: localUser.id,
          },
        });
        if (existingMember) {
          res.cookie(
            ACTIVE_ORG_COOKIE,
            invitation.organizationId,
            ACTIVE_ORG_COOKIE_OPTIONS,
          );
          return {
            success: true,
            status: "accepted",
            organizationId: invitation.organizationId,
            organizationName: invitation.organization.name,
            role: existingMember.role,
            redirectTo: "/portal",
          };
        }
      }
      throw new BadRequestException(`Invitation is ${invitation.status}`);
    }

    const accepted = await this.prisma.$transaction(async (tx) => {
      const userWhere = [
        ...(authenticatedUser.workosUserId
          ? [{ workosUserId: authenticatedUser.workosUserId }]
          : []),
        { email: { equals: authenticatedEmail, mode: "insensitive" as const } },
      ];
      let user = await tx.user.findFirst({ where: { OR: userWhere } });

      if (
        user?.workosUserId &&
        authenticatedUser.workosUserId &&
        user.workosUserId !== authenticatedUser.workosUserId
      ) {
        throw new ForbiddenException(
          "Authenticated WorkOS user does not match the existing local account",
        );
      }

      if (user) {
        const updateData: {
          workosUserId?: string;
          emailVerified?: boolean;
          image?: string | null;
        } = {};
        if (!user.workosUserId && authenticatedUser.workosUserId) {
          updateData.workosUserId = authenticatedUser.workosUserId;
        }
        if (authenticatedUser.emailVerified && !user.emailVerified) {
          updateData.emailVerified = true;
        }
        if (!user.image && authenticatedUser.image) {
          updateData.image = authenticatedUser.image;
        }
        if (Object.keys(updateData).length) {
          user = await tx.user.update({
            where: { id: user.id },
            data: updateData,
          });
        }
      } else {
        user = await tx.user.create({
          data: {
            id: randomUUID(),
            email: authenticatedEmail,
            name: authenticatedUser.name,
            emailVerified: authenticatedUser.emailVerified,
            image: authenticatedUser.image,
            workosUserId: authenticatedUser.workosUserId,
          },
        });
      }

      const existingMember = await tx.member.findFirst({
        where: { organizationId: invitation.organizationId, userId: user.id },
      });
      const member =
        existingMember ??
        (await tx.member.create({
          data: {
            id: randomUUID(),
            organizationId: invitation.organizationId,
            userId: user.id,
            role: invitation.role ?? "member",
          },
        }));

      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: "accepted" },
      });

      return { user, member };
    });

    res.cookie(
      ACTIVE_ORG_COOKIE,
      invitation.organizationId,
      ACTIVE_ORG_COOKIE_OPTIONS,
    );
    return {
      success: true,
      status: "accepted",
      organizationId: invitation.organizationId,
      organizationName: invitation.organization.name,
      userId: accepted.user.id,
      role: accepted.member.role,
      redirectTo: "/portal",
    };
  }

  async generateResetLink(
    memberId: string,
    orgId: string,
    requestingUserId: string,
    requestingRole: string,
  ): Promise<{
    url: string;
    email: string;
    emailSent: boolean;
    emailViaOrgConfig: boolean;
  }> {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
      include: { user: { select: { id: true, email: true } } },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException(
        "Cannot reset your own password — use forgot-password instead",
      );
    }
    if (member.role === "owner" && requestingRole !== "owner") {
      throw new ForbiddenException("Only owners can reset another owner");
    }

    const { url, emailSent, emailViaOrgConfig } =
      await this.authService.generateResetLink(member.user.email);
    return {
      url,
      email: member.user.email,
      emailSent,
      emailViaOrgConfig,
    };
  }

  async removeMember(
    memberId: string,
    orgId: string,
    requestingUserId: string,
    requestingRole: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException("Cannot remove yourself");
    }
    if (member.role === "owner" && requestingRole !== "owner") {
      throw new BadRequestException("Only owners can remove other owners");
    }

    // Scope ProjectClient deletion to this org's projects only
    const orgProjectIds = await this.prisma.project.findMany({
      where: { organizationId: orgId },
      select: { id: true },
    });
    const projectIds = orgProjectIds.map((p) => p.id);

    await this.prisma.$transaction([
      this.prisma.projectClient.deleteMany({
        where: { userId: member.userId, projectId: { in: projectIds } },
      }),
      this.prisma.member.delete({ where: { id: memberId } }),
    ]);
  }

  async changeRole(
    memberId: string,
    newRole: string,
    orgId: string,
    requestingUserId: string,
  ) {
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    if (member.userId === requestingUserId) {
      throw new BadRequestException("Cannot change your own role");
    }
    if (member.role === "owner") {
      const ownerCount = await this.prisma.member.count({
        where: { organizationId: orgId, role: "owner" },
      });
      if (ownerCount <= 1) {
        throw new BadRequestException("Cannot demote the last owner");
      }
    }
    const validRoles = ["owner", "admin", "member"];
    if (!validRoles.includes(newRole)) {
      throw new BadRequestException("Invalid role");
    }
    return this.prisma.member.update({
      where: { id: memberId },
      data: { role: newRole },
    });
  }

  async setMemberRate(
    memberId: string,
    orgId: string,
    actorUserId: string,
    actorRole: string,
    rate: number | null,
  ) {
    if (actorRole !== "owner") {
      throw new ForbiddenException("Only owners can set member rates");
    }
    const member = await this.prisma.member.findFirst({
      where: { id: memberId, organizationId: orgId },
    });
    if (!member) throw new NotFoundException("Member not found");
    return this.prisma.member.update({
      where: { id: memberId },
      data: { hourlyRateCents: rate },
    });
  }

  async getProfile(userId: string, orgId: string) {
    const profile = await this.prisma.clientProfile.findUnique({
      where: { userId_organizationId: { userId, organizationId: orgId } },
    });
    return (
      profile || {
        userId,
        organizationId: orgId,
        company: null,
        phone: null,
        address: null,
        website: null,
        description: null,
      }
    );
  }

  async updateProfile(
    userId: string,
    orgId: string,
    dto: UpdateClientProfileDto,
  ) {
    return this.prisma.clientProfile.upsert({
      where: { userId_organizationId: { userId, organizationId: orgId } },
      create: { userId, organizationId: orgId, ...dto },
      update: dto,
    });
  }
}
