/**
 * Next 16 Proxy.
 *
 * 1. Optimistic admin gate (/admin/*). Only checks that the session cookie
 *    EXISTS; the real check is the server-side /auth/me call in
 *    app/admin/(console)/layout.tsx, and the Go API enforces every request.
 *    - /admin/login and /admin/invite are public.
 *    - No cookie -> 307 to /admin/login?next=<path+search>.
 *    - Otherwise forwards the requested path+search as `x-admin-path` so the
 *      console layout can build the same `next` when the cookie turns out stale.
 * 2. IndexNow key file: /<INDEXNOW_KEY>.txt (text/plain) when INDEXNOW_KEY is set.
 * 3. Managed redirects from the API (src/lib/seo/redirects.ts): 301 to the
 *    target or 410 Gone, one hop, fail open. next.config.ts redirects (the
 *    legacy Wix table) run BEFORE this and stay authoritative for their paths.
 */
import { NextResponse, type NextRequest } from "next/server";
import { isPublicAdminPath, loginUrl } from "@/lib/admin/next-path";
import { goneHtml, lookupRedirect } from "@/lib/seo/redirects";

const ADMIN_COOKIE = "escoma_admin";
const INDEXNOW_KEY_RE = /^[a-zA-Z0-9-]{8,128}$/;

function adminGate(request: NextRequest) {
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

function indexNowKey(pathname: string): Response | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !INDEXNOW_KEY_RE.test(key) || pathname !== `/${key}.txt`) return null;
  return new Response(key, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return adminGate(request);

  const key = indexNowKey(pathname);
  if (key) return key;

  if (request.method !== "GET" && request.method !== "HEAD") return NextResponse.next();

  const rule = await lookupRedirect(pathname);
  if (!rule) return NextResponse.next();

  if (rule.status === 410) {
    return new Response(request.method === "HEAD" ? null : goneHtml(), {
      status: 410,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "X-Robots-Tag": "noindex",
        "Cache-Control": "public, max-age=300",
      },
    });
  }

  const target = new URL(rule.to!, request.url);
  if (search && !target.search) target.search = search;
  return NextResponse.redirect(target, 301);
}

export const config = {
  matcher: [
    // Admin pages only: /api/admin/* (the API proxy, incl. public token
    // endpoints) never matches.
    "/admin",
    "/admin/:path*",
    // Public pages for managed redirects + the IndexNow key file. Skips Next
    // assets, route handlers, /images and static files, so assets never pay
    // for a lookup (the lookup itself is an in-memory Map hit).
    "/((?!_next/|api/|images/|.*\\.(?:js|mjs|css|map|png|jpe?g|webp|avif|gif|svg|ico|woff2?|ttf|otf|json|xml|webmanifest)$).*)",
  ],
};
