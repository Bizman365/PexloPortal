import { getSignInUrl } from "@workos-inc/authkit-nextjs";
import { NextResponse, type NextRequest } from "next/server";

// Note: this lives at a "route.ts" (Route Handler), not a "page.tsx".
//
// @workos-inc/authkit-nextjs's getSignInUrl() internally calls
// getAuthURLAndSetPKCECookie() — which writes a PKCE state cookie. Next.js 15+
// only allows cookie mutation in Server Actions and Route Handlers, NOT in
// Server Components / pages. If this is a page.tsx, every visit crashes with:
//   Error: Cookies can only be modified in a Server Action or Route Handler.
//   digest: '2260099876'
//
// Route Handlers are explicitly allowed to mutate cookies, so we put the
// sign-in URL generation here and 302-redirect to AuthKit. The matcher in
// middleware.ts continues to handle this path without auth checks.

function safeCallback(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return "/portal";
  return raw;
}

export async function GET(request: NextRequest) {
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
  const loginHint = request.nextUrl.searchParams.get("loginHint") || undefined;
  const signInUrl = await getSignInUrl({
    returnTo: safeCallback(callbackUrl),
    loginHint,
  });
  return NextResponse.redirect(signInUrl);
}
