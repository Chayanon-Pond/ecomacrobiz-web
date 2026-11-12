/**
 * Same-origin proxy: /api/admin/<path> -> ${API_URL}/api/v1/admin/<path>.
 *
 * The browser only ever talks to the Next origin, so the session cookie
 * (escoma_admin, HttpOnly, SameSite=Strict) is first-party and API_URL stays
 * server-side. Auth and CSRF are enforced by the Go API; this layer forwards
 * the minimum it needs, whitelists the path, caps the body size and keeps
 * the public /knowledge cache in sync after post mutations.
 */
import type { NextRequest } from "next/server";
import { revalidateTag } from "next/cache";
import {
  ADMIN_COOKIE,
  MAX_BODY_BYTES,
  clientIp,
  errorEnvelope,
  limitStream,
  rewriteSetCookie,
  safeAdminPath,
} from "@/lib/admin/proxy";

type Ctx = { params: Promise<{ path: string[] }> };

const UPSTREAM_TIMEOUT_MS = 30_000;

const PASS_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "retry-after",
  "x-request-id",
] as const;

function apiBase(): string | null {
  const raw = process.env.API_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function upstreamHeaders(req: NextRequest): Headers {
  const h = new Headers();
  const session = req.cookies.get(ADMIN_COOKIE)?.value;
  if (session) h.set("cookie", `${ADMIN_COOKIE}=${session}`);
  for (const name of ["content-type", "x-csrf-token", "origin", "user-agent", "accept"]) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  const ip = clientIp(req.headers);
  if (ip) h.set("x-forwarded-for", ip);
  return h;
}

async function slugOfPost(base: string, id: string, req: NextRequest): Promise<string | null> {
  try {
    const h = upstreamHeaders(req);
    h.delete("content-type");
    const res = await fetch(`${base}/api/v1/admin/posts/${encodeURIComponent(id)}`, {
      headers: h,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { slug?: unknown } };
    return typeof json.data?.slug === "string" ? json.data.slug : null;
  } catch {
    return null;
  }
}

function revalidatePosts(slugs: (string | null | undefined)[]) {
  // Route handler (not a Server Action) -> expire immediately so the next
  // visit to /knowledge renders fresh data instead of stale-while-revalidate.
  revalidateTag("posts", { expire: 0 });
  for (const slug of new Set(slugs)) {
    if (slug) revalidateTag(`post:${slug}`, { expire: 0 });
  }
}

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const base = apiBase();
  if (!base) {
    return errorEnvelope("internal", "ระบบหลังบ้านยังไม่พร้อมใช้งาน (API_URL is not configured)", 503);
  }

  const { path: segments } = await ctx.params;
  const path = safeAdminPath(segments);
  if (!path) return errorEnvelope("not_found", "ไม่พบเส้นทางที่ร้องขอ", 404);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (hasBody && Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorEnvelope("payload_too_large", "ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด (สูงสุด 8 MB)", 413);
  }

  const isPostMutation = hasBody && segments[0] === "posts";
  const postId = isPostMutation && segments.length === 2 ? segments[1] : null;
  const oldSlug =
    postId && (method === "PUT" || method === "PATCH" || method === "DELETE")
      ? await slugOfPost(base, postId, req)
      : null;

  let tooLarge = false;
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: upstreamHeaders(req),
    cache: "no-store",
    redirect: "manual",
    signal: AbortSignal.any([req.signal, AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)]),
  };
  if (hasBody && req.body) {
    init.body = limitStream(req.body, MAX_BODY_BYTES, () => {
      tooLarge = true;
    });
    init.duplex = "half";
  }

  const target = `${base}/api/v1/admin/${path}${req.nextUrl.search}`;
  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (err) {
    if (tooLarge) {
      return errorEnvelope("payload_too_large", "ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด (สูงสุด 8 MB)", 413);
    }
    if (req.signal.aborted) {
      // Browser went away (navigation / AbortController); nobody reads this.
      return new Response(null, { status: 499 });
    }
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[admin-proxy] upstream request failed", method, path, err);
    return errorEnvelope(
      "internal",
      timedOut ? "เซิร์ฟเวอร์ตอบสนองช้าเกินไป กรุณาลองใหม่" : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่",
      timedOut ? 504 : 502,
    );
  }

  const headers = new Headers({
    "cache-control": "no-store, private",
    "x-robots-tag": "noindex, nofollow",
  });
  for (const name of PASS_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  for (const c of upstream.headers.getSetCookie()) {
    headers.append("set-cookie", rewriteSetCookie(c));
  }

  const ok = upstream.status >= 200 && upstream.status < 300;
  if (isPostMutation && ok) {
    // Small JSON bodies: buffer to read the (possibly new) slug.
    const text = upstream.status === 204 ? "" : await upstream.text();
    let newSlug: string | null = null;
    try {
      const json = text ? (JSON.parse(text) as { data?: { slug?: unknown } }) : null;
      if (typeof json?.data?.slug === "string") newSlug = json.data.slug;
    } catch {
      /* non-JSON success body: still revalidate the list */
    }
    revalidatePosts([oldSlug, newSlug]);
    return new Response(upstream.status === 204 ? null : text, { status: upstream.status, headers });
  }

  const nullBody = upstream.status === 204 || upstream.status === 304 || method === "HEAD";
  return new Response(nullBody ? null : upstream.body, { status: upstream.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
