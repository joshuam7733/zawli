import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic gate only: sends visitors without a session cookie to /login.
 * Real authentication and authorisation happen on the server for every page,
 * action and API route (src/server/session.ts, src/server/authz.ts).
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.endsWith("zawli.session_token"));
  if (!hasSession) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
