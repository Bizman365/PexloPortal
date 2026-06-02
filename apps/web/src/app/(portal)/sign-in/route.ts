import { NextResponse, type NextRequest } from "next/server";

// Convenience redirect from /sign-in → /portal/sign-in (the canonical AuthKit
// entry route handler that initiates the WorkOS sign-in flow). Preserves the
// callbackUrl query param so the post-auth landing target is honored.
//
// IMPORTANT: NextResponse.redirect() requires an absolute URL or a Request
// context. When we use new URL("/path", request.url), request.url is the
// internal URL Next.js sees — which on Hetzner is http://localhost:3000/...
// because Caddy reverse-proxies the public domain to localhost:3000.
// That would result in clients being told to redirect to localhost.
//
// Solution: build the redirect against request.nextUrl (which preserves the
// public origin from the original request) instead of request.url.
export function GET(request: NextRequest) {
  const url = request.nextUrl.clone();
  url.pathname = "/portal/sign-in";
  // Preserve callbackUrl/loginHint if present; clear other params.
  const callbackUrl = request.nextUrl.searchParams.get("callbackUrl");
  const loginHint = request.nextUrl.searchParams.get("loginHint");
  url.search = "";
  if (callbackUrl) url.searchParams.set("callbackUrl", callbackUrl);
  if (loginHint) url.searchParams.set("loginHint", loginHint);
  return NextResponse.redirect(url);
}
