import { NextRequest, NextResponse } from "next/server";

// Derive the canonical hostname from WEB_URL (e.g. "https://app.example.com" → "app.example.com")
const WEB_URL = process.env.WEB_URL ?? "";
const MAIN_DOMAIN = WEB_URL ? new URL(WEB_URL).hostname : "";

// Internal hostnames that are never custom domains
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"]);

function hostname(host: string): string {
  // Strip port — "example.com:3000" → "example.com"
  return host.includes(":") ? host.split(":")[0] : host;
}

// Web middleware ONLY handles custom-domain detection (x-custom-host header).
//
// WorkOS session resolution happens on the NestJS API side
// (apps/api/src/auth/session.middleware.ts reads the wos-session cookie via
// loadSealedSession). The web layer proxies cookies to the API via
// lib/auth.ts:getSession() and never tries to read/write the session cookie
// from server components — Next.js 15+ forbids cookie mutation outside
// Server Actions / Route Handlers, which crashes the @workos-inc/authkit-nextjs
// authkit() composable when invoked from middleware that touches cookies.
//
// Avoiding authkit() here is intentional. If WorkOS hooks like useAuth() are
// ever needed client-side, add AuthKitProvider at the root layout level.
export function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const name = hostname(host);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);
  requestHeaders.set("x-search", request.nextUrl.search);

  if (!MAIN_DOMAIN || name === hostname(MAIN_DOMAIN) || LOOPBACK_HOSTS.has(name)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Custom domain: inject header so server components can read it
  requestHeaders.set("x-custom-host", name);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next|favicon.ico).*)"],
};
