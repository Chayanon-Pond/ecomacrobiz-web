/**
 * Same-origin proxy: /api/community/<path> -> ${API_URL}/api/v1/community/<path>.
 *
 * The member cookie (escoma_member, HttpOnly, SameSite=Lax) stays first-party
 * and API_URL stays server-side. Auth, CSRF, Origin checks and rate limits are
 * enforced by the Go API; this layer forwards the minimum it needs
 * (CONTRACT-COMMUNITY §9): only member cookies (never escoma_admin), a single
 * client IP, a whitelisted path and a capped body. OAuth 302s pass through
 * with their Location.
 */
import type { NextRequest } from "next/server";
import {
  MAX_BODY_BYTES,
  clientIp,
  errorEnvelope,
  isAllowedSetCookie,
  isPublicCacheable,
  limitStream,
  rewriteSetCookie,
  safeCommunityPath,
  upstreamCookie,
} from "@/lib/community/proxy";

type Ctx = { params: Promise<{ path: string[] }> };

const UPSTREAM_TIMEOUT_MS = 30_000;
const TOO_LARGE = "ไฟล์หรือข้อมูลมีขนาดใหญ่เกินกำหนด (สูงสุด 6 MB)";

const PASS_RESPONSE_HEADERS = [
  "content-type",
  "content-disposition",
  "retry-after",
  "x-request-id",
  "location",
] as const;

function apiBase(): string | null {
  const raw = process.env.API_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

function upstreamHeaders(req: NextRequest, segments: string[]): Headers {
  const h = new Headers();
  const cookie = upstreamCookie(req.cookies.getAll(), segments);
  if (cookie) h.set("cookie", cookie);
  for (const name of ["content-type", "x-csrf-token", "origin", "user-agent", "accept"]) {
    const v = req.headers.get(name);
    if (v) h.set(name, v);
  }
  const ip = clientIp(req.headers);
  if (ip) h.set("x-forwarded-for", ip);
  return h;
}

async function handle(req: NextRequest, ctx: Ctx): Promise<Response> {
  const base = apiBase();
  if (!base) return errorEnvelope("internal", "ระบบชุมชนยังไม่พร้อมใช้งาน", 503);

  const { path: segments } = await ctx.params;
  const path = safeCommunityPath(segments);
  if (!path) return errorEnvelope("not_found", "ไม่พบเส้นทางที่ร้องขอ", 404);

  const method = req.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  const declared = Number(req.headers.get("content-length") ?? "0");
  if (hasBody && Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return errorEnvelope("payload_too_large", TOO_LARGE, 413);
  }

  let tooLarge = false;
  const init: RequestInit & { duplex?: "half" } = {
    method,
    headers: upstreamHeaders(req, segments),
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

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/api/v1/community/${path}${req.nextUrl.search}`, init);
  } catch (err) {
    if (tooLarge) return errorEnvelope("payload_too_large", TOO_LARGE, 413);
    if (req.signal.aborted) return new Response(null, { status: 499 });
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    console.error("[community-proxy] upstream request failed", method, segments[0], err);
    return errorEnvelope(
      "internal",
      timedOut ? "เซิร์ฟเวอร์ตอบสนองช้าเกินไป กรุณาลองใหม่" : "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่",
      timedOut ? 504 : 502,
    );
  }

  const publicCache = isPublicCacheable(method, segments) && upstream.ok;
  const headers = new Headers({
    "cache-control": (publicCache && upstream.headers.get("cache-control")) || "no-store, private",
    "x-robots-tag": "noindex, nofollow",
  });
  for (const name of PASS_RESPONSE_HEADERS) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  for (const c of upstream.headers.getSetCookie()) {
    if (isAllowedSetCookie(c)) headers.append("set-cookie", rewriteSetCookie(c));
  }

  const nullBody = upstream.status === 204 || upstream.status === 304 || method === "HEAD";
  return new Response(nullBody ? null : upstream.body, { status: upstream.status, headers });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
