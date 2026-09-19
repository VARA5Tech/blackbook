import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap gate only: it checks for the presence of a session cookie so signed-out
 * visitors are redirected before a page renders.
 *
 * It is not the authorization boundary. Every service call independently loads
 * the session and asserts a capability, because a cookie's presence proves
 * nothing about whether it is still valid.
 *
 * For the same reason it never redirects *away* from the sign-in page. A cookie
 * whose session row is gone — revoked, expired, cleaned up, or a database
 * restored underneath it — would otherwise bounce between the shell, which
 * finds no actor and sends the visitor to sign in, and here, which sees the
 * cookie and sends them back. The sign-in page turns a signed-in visitor away
 * itself, where the session is actually read.
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

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals, the auth API, the health check that
     * the container orchestrator polls, the website's private access lookup,
     * and public brand assets.
     *
     * The lookup is called server to server by vara5.com, which has no
     * staff session; it authenticates each request by signature itself.
     *
     * The manifest and icons must stay reachable without a session: a browser
     * asks for them before anyone signs in, and redirecting the manifest to
     * the sign-in page breaks installation and the tab icon.
     */
    "/((?!api/auth|api/health|api/private-access|_next/static|_next/image|favicon.ico|site.webmanifest|brand/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
