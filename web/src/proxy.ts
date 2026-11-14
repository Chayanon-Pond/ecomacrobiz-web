/**
 * Optimistic admin gate (Next 16 Proxy). Only checks that the session cookie
 * EXISTS; the real check is the server-side /auth/me call in
 * app/admin/(console)/layout.tsx, and the Go API enforces every request.
 *
 * - /admin/login and /admin/invite are public.
 * - No cookie -> 307 to /admin/login?next=<path+search>.
 * - Otherwise forwards the requested path+search as `x-admin-path` so the
 *   console layout can build the same `next` when the cookie turns out stale.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAdminPath, loginUrl } from "@/lib/admin/next-path";

const ADMIN_COOKIE = "escoma_admin";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublicAdminPath(pathname)) return NextResponse.next();

  const target = `${pathname}${search}`;
  if (!request.cookies.get(ADMIN_COOKIE)?.value) {
    return NextResponse.redirect(new URL(loginUrl(target), request.url));
  }

  const headers = new Headers(request.headers);
  headers.set("x-admin-path", target);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // Page routes only: /api/admin/* (the API proxy, incl. public token
  // endpoints) and /_next assets never match.
  matcher: ["/admin", "/admin/:path*"],
};
