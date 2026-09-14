import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate only: it checks for the presence of a session cookie so signed-out
 * visitors are redirected before a page renders.
 *
 * It is not the authorization boundary. Every service call independently loads
 * the session and asserts a capability, because a cookie's presence proves
 * nothing about whether it is still valid.
 */
export default function proxy(request: NextRequest) {
  const hasSession = Boolean(getSessionCookie(request));
  const { pathname, search } = request.nextUrl;
  const isSignIn = pathname.startsWith("/sign-in");
  // Reachable signed out, because they exist for people who cannot sign in yet.
  const isPublic =
    isSignIn ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/invite/");

  if (!hasSession && !isPublic) {
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (hasSession && isSignIn) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the auth API, the health check that
     * the container orchestrator polls, and public brand assets.
     *
     * The manifest and icons must stay reachable without a session: a browser
     * asks for them before anyone signs in, and redirecting the manifest to
     * the sign-in page breaks installation and the tab icon.
     */
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico|site.webmanifest|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
