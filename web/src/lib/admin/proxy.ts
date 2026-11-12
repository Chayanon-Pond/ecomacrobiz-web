/**
 * Pure helpers for the admin API proxy (src/app/api/admin/[...path]/route.ts).
 * Kept free of Next imports so they are easy to reason about and test.
 */

export const ADMIN_COOKIE = "escoma_admin";

/** Multipart media uploads are capped at 8 MB by the API; allow form overhead. */
export const MAX_BODY_BYTES = 8 * 1024 * 1024 + 64 * 1024;

const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/;

/** Validates catch-all segments; returns null when any segment is unsafe. */
export function safeAdminPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0 || segments.length > 8) return null;
  for (const s of segments) {
    if (!SEGMENT_RE.test(s) || s === "." || s === "..") return null;
  }
  return segments.map(encodeURIComponent).join("/");
}

/**
 * Keeps the API's cookie attributes (HttpOnly, SameSite, Secure, Max-Age)
 * but forces Path=/ and drops Domain: the browser talks to the Next origin,
 * so a Domain pointing at the API host would make it reject the cookie.
 */
export function rewriteSetCookie(cookie: string): string {
  const [pair, ...attrs] = cookie.split(";");
  const kept = attrs
    .map((a) => a.trim())
    .filter((a) => a && !/^path\s*=/i.test(a) && !/^domain\s*=/i.test(a));
  return [pair.trim(), "Path=/", ...kept].join("; ");
}

/** Single trustworthy client IP — shared with /api/contact. */
export { clientIp } from "@/lib/client-ip";

export function errorEnvelope(code: string, message: string, status: number, headers?: HeadersInit) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store", ...headers } },
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
