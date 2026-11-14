/**
 * Pure helpers for the member API proxy (src/app/api/community/[...path]/route.ts).
 * Free of Next imports so they are easy to reason about and test.
 *
 * Identity separation (CONTRACT-COMMUNITY §0): this proxy forwards ONLY the
 * member cookie (+ the short-lived OAuth binding cookie on the Google routes),
 * never `escoma_admin`.
 */

export const MEMBER_COOKIE = "escoma_member";
export const OAUTH_COOKIE = "escoma_oauth";

/** Comment images / avatars are ≤ 5 MB (COMMENT_IMAGE_MAX_MB); allow multipart overhead. */
export const MAX_BODY_BYTES = 6 * 1024 * 1024 + 200 * 1024;

/** First path segment the community API serves. */
const ROOTS = new Set(["config", "auth", "account", "stats", "posts", "comments", "uploads"]);

// Post slugs may be Thai (legacy Wix slugs): letters/marks/digits of any script.
const SEGMENT_RE = /^[\p{L}\p{M}\p{N}._~-]{1,200}$/u;

/** Validates catch-all segments; returns the encoded upstream path or null. */
export function safeCommunityPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0 || segments.length > 6) return null;
  if (!ROOTS.has(segments[0])) return null;
  for (const s of segments) {
    if (!SEGMENT_RE.test(s) || s === "." || s === "..") return null;
  }
  return segments.map((s) => encodeURIComponent(s.normalize("NFC"))).join("/");
}

export function isOAuthPath(segments: string[]): boolean {
  return segments[0] === "auth" && segments[1] === "google";
}

/**
 * The upstream `cookie` header: only `escoma_member`, plus `escoma_oauth`
 * on auth/google/*. Returns null when there is nothing to forward.
 */
export function upstreamCookie(
  cookies: { name: string; value: string }[],
  segments: string[],
): string | null {
  const allowed = new Set([MEMBER_COOKIE]);
  if (isOAuthPath(segments)) allowed.add(OAUTH_COOKIE);
  const pairs: string[] = [];
  const seen = new Set<string>();
  for (const c of cookies) {
    if (!allowed.has(c.name) || seen.has(c.name) || !c.value) continue;
    // Cookie values from the API are base64url; refuse anything that could
    // smuggle extra pairs into the header.
    if (/[;\r\n]/.test(c.value)) continue;
    seen.add(c.name);
    pairs.push(`${c.name}=${c.value}`);
  }
  return pairs.length ? pairs.join("; ") : null;
}

/**
 * Keeps every attribute the API set, including Path (the API scopes
 * escoma_oauth to /api/community/auth/google and escoma_member to /), and
 * drops Domain: the browser talks to the Next origin, so a Domain pointing
 * at the API host would make it reject the cookie.
 */
export function rewriteSetCookie(cookie: string): string {
  const [pair, ...attrs] = cookie.split(";");
  const kept = attrs.map((a) => a.trim()).filter((a) => a && !/^domain\s*=/i.test(a));
  return [pair.trim(), ...kept].join("; ");
}

/** Only member cookies may be set through this proxy. */
export function isAllowedSetCookie(cookie: string): boolean {
  const name = cookie.split("=", 1)[0]?.trim();
  return name === MEMBER_COOKIE || name === OAUTH_COOKIE;
}

/** Public, cookie-independent GETs whose upstream Cache-Control may pass through. */
export function isPublicCacheable(method: string, segments: string[]): boolean {
  return method === "GET" && segments.length === 1 && (segments[0] === "config" || segments[0] === "stats");
}

export { clientIp } from "@/lib/client-ip";

export function errorEnvelope(code: string, message: string, status: number) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store, private", "x-robots-tag": "noindex, nofollow" } },
  );
}

/** Wraps a request body stream and errors once more than `limit` bytes pass. */
export function limitStream(
  body: ReadableStream<Uint8Array>,
  limit: number,
  onExceeded: () => void,
): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > limit) {
          onExceeded();
          controller.error(new Error("payload too large"));
          return;
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
