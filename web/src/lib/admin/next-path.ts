/**
 * `?next=` handling for /admin/login. Only same-origin /admin paths are
 * accepted (blocks //evil.com, /\evil.com, absolute URLs, javascript: and
 * loops back to the public auth pages). Shared by proxy.ts, the console
 * layout and the login form.
 */
const PUBLIC_ADMIN = ["/admin/login", "/admin/invite"];

export function isPublicAdminPath(pathname: string): boolean {
  return PUBLIC_ADMIN.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function safeNext(raw: string | null | undefined, fallback = "/admin"): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "http://admin.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://admin.invalid") return fallback;
  const p = url.pathname;
  if (p !== "/admin" && !p.startsWith("/admin/")) return fallback;
  if (isPublicAdminPath(p)) return fallback;
  return `${p}${url.search}`;
}

export function loginUrl(next: string | null | undefined): string {
  const n = safeNext(next, "");
  return n && n !== "/admin" ? `/admin/login?next=${encodeURIComponent(n)}` : "/admin/login";
}
