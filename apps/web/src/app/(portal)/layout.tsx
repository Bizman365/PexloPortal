import { Suspense } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { SignOutButton } from "./sign-out-button";
import { getSession } from "@/lib/auth";
import { safeJson } from "@/lib/safe-fetch";
import { NotificationBell } from "@/components/notification-bell";
import { DynamicFavicon } from "@/components/dynamic-favicon";
import { PreviewModeProvider } from "@/lib/preview-mode";
import { PreviewBanner } from "@/components/preview-banner";
import { ThemeToggle } from "@/components/theme-toggle";

const API_URL = process.env.API_URL || "http://localhost:3001";

interface BrandingResponse {
  logoKey?: string;
  logoUrl?: string;
  organizationId?: string;
  primaryColor?: string;
  accentColor?: string;
  hideLogo?: boolean;
}

async function getBranding(): Promise<BrandingResponse | null> {
  try {
    const cookieStore = await cookies();
    const res = await fetch(
      `${API_URL}/api/branding`,
      {
        headers: { Cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    return await safeJson<BrandingResponse>(res);
  } catch {
    return null;
  }
}

async function getOrgName() {
  try {
    const cookieStore = await cookies();
    const res = await fetch(
      `${API_URL}/api/auth/organization/get-full-organization`,
      {
        headers: { Cookie: cookieStore.toString() },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const org = await safeJson<{ name?: string }>(res);
    return org?.name || null;
  } catch {
    return null;
  }
}

function getLogoSrc(branding: { logoKey?: string; logoUrl?: string; organizationId?: string } | null) {
  if (!branding) return null;
  if (branding.logoKey) {
    return `${API_URL}/api/branding/logo/${branding.organizationId}?k=${encodeURIComponent(branding.logoKey)}`;
  }
  if (branding.logoUrl) {
    return branding.logoUrl;
  }
  return null;
}

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") || "";
  const search = headersList.get("x-search") || "";
  const isPreviewRequest = new URLSearchParams(
    search.startsWith("?") ? search.slice(1) : search,
  ).has("previewAs");
  const isClientAuthSurface =
    pathname.startsWith("/portal/status") ||
    pathname.startsWith("/status") ||
    pathname.startsWith("/portal/sign-in") ||
    pathname.startsWith("/sign-in");

  if (isClientAuthSurface) {
    return (
      <>
        <div className="fixed right-4 top-4 z-50">
          <ThemeToggle />
        </div>
        {children}
      </>
    );
  }

  const [session, branding, orgName] = await Promise.all([
    getSession(),
    getBranding(),
    getOrgName(),
  ]);
  if (!session) {
    redirect("/portal/sign-in");
  }

  // Role-based routing: owners and admins belong in /dashboard (full sidebar +
  // admin tools). The /portal surface is for clients/members. Mirrors the
  // inverse check in (dashboard)/layout.tsx that bounces members to /portal.
  // Anyone arriving via post-auth handleAuth() landing, a bookmark, or a deep
  // link gets routed correctly here.
  const role = session.member?.role;
  if ((role === "owner" || role === "admin") && !isPreviewRequest) {
    redirect("/dashboard");
  }

  const logoSrc = getLogoSrc(branding);

  return (
    <Suspense fallback={null}>
      <PreviewModeProvider>
        <div
          style={
            {
              "--primary": branding?.primaryColor || "#006b68",
              "--accent": branding?.accentColor || "#ff6b5c",
            } as React.CSSProperties
          }
        >
          <DynamicFavicon href={logoSrc || "/icon.png"} />
          <PreviewBanner />
          <header className="border-b border-[var(--border)] px-6 py-4 flex items-center gap-3">
            {!branding?.hideLogo && logoSrc ? (
              /* Custom logo: full wordmark, left-aligned, naturally sized */
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={logoSrc} alt={orgName || ""} className="h-10 w-auto object-contain shrink-0" />
            ) : (
              <span className="font-semibold">{orgName || "Pexlo Portal"}</span>
            )}
            <div className="flex-1" />
            <Link
              href="/portal"
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Projects
            </Link>
            <Link
              href="/portal/settings"
              className="text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
            >
              Settings
            </Link>
            <NotificationBell />
            <ThemeToggle />
            <SignOutButton />
          </header>
          <main className="max-w-6xl mx-auto p-4 sm:p-6 lg:p-8">{children}</main>
        </div>
      </PreviewModeProvider>
    </Suspense>
  );
}
