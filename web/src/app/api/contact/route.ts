/**
 * POST /api/contact — same-origin endpoint for the contact form.
 * Validates with the shared rules, then forwards to the Go API
 * (API_URL/api/v1/contact) with the visitor's X-Forwarded-For + User-Agent so
 * the API can rate-limit and log per client (it trusts XFF only from
 * TRUSTED_PROXIES, i.e. this server). API status codes 201/422/429/413 are
 * passed through; an unreachable/unset API becomes 503 with a Thai message.
 */
import { apiRequest, ApiUnavailableError } from "@/lib/api/client";
import { validateContact } from "@/lib/contact/validation";
import { clientIp } from "@/lib/client-ip";

const MAX_BODY_BYTES = 16 * 1024;
const FORWARD_TIMEOUT_MS = 8000;

type Envelope = { error: { code: string; message: string; fields?: Record<string, string> } };

function reply(status: number, body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function fail(status: number, code: string, message: string, extra: Partial<Envelope["error"]> = {}, headers?: Record<string, string>) {
  return reply(status, { error: { code, message, ...extra } } satisfies Envelope, headers);
}

const UNAVAILABLE = "ขออภัย ระบบรับข้อความขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง หรือติดต่อเราทางโทรศัพท์หรือ LINE";

export async function POST(request: Request) {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) {
    return fail(415, "validation_failed", "รูปแบบข้อมูลไม่ถูกต้อง");
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินไป");
  }
  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return fail(413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินไป");
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, "validation_failed", "รูปแบบข้อมูลไม่ถูกต้อง");
  }

  const result = validateContact(body);
  if (!result.ok) {
    return fail(422, "validation_failed", "กรุณาตรวจสอบข้อมูลที่กรอก", { fields: result.errors as Record<string, string> });
  }

  // Single trustworthy client IP (see src/lib/client-ip.ts).
  const forwardedFor = clientIp(request.headers) ?? "";
  const userAgent = (request.headers.get("user-agent") ?? "").slice(0, 512);

  try {
    const res = await apiRequest<unknown>("/api/v1/contact", {
      method: "POST",
      body: result.data,
      timeoutMs: FORWARD_TIMEOUT_MS,
      headers: {
        ...(forwardedFor ? { "X-Forwarded-For": forwardedFor } : {}),
        ...(userAgent ? { "User-Agent": userAgent } : {}),
      },
    });

    if ([201, 400, 413, 422, 429].includes(res.status) && res.data) {
      const retryAfter = res.headers.get("retry-after");
      return reply(res.status, res.data, retryAfter ? { "Retry-After": retryAfter } : {});
    }
    console.error(`[contact] API responded ${res.status}`);
    return fail(502, "internal", UNAVAILABLE);
  } catch (err) {
    if (err instanceof ApiUnavailableError) {
      if (err.reason !== "unconfigured") console.error(`[contact] ${err.message}`);
      return fail(503, "internal", UNAVAILABLE);
    }
    console.error("[contact] unexpected error", err);
    return fail(500, "internal", UNAVAILABLE);
  }
}
