/**
 * POST /api/revalidate — called by the Go API after a post is created,
 * updated or deleted (CONTRACTS.md):
 *   header  x-revalidate-secret: <REVALIDATE_SECRET>
 *   body    { "tags": ["posts", "post:<slug>"] }
 *
 * Uses revalidateTag(tag, { expire: 0 }): this is a webhook (updateTag is
 * Server-Action only), and an editor expects the next visit to show the
 * change, so stale content must not be served while it regenerates.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { revalidateTag } from "next/cache";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_TAGS = 50;
// "posts" or "post:<slug>" (slug may be Thai; no whitespace; tag limit 256).
const TAG_RE = /^(?:posts|post:[^\s]{1,250})$/u;

function json(status: number, body: unknown) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function error(status: number, code: string, message: string) {
  return json(status, { error: { code, message } });
}

/** Constant-time comparison (hash first so lengths always match). */
function secretMatches(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return error(503, "internal", "ยังไม่ได้ตั้งค่า REVALIDATE_SECRET");
  }
  const given = request.headers.get("x-revalidate-secret") ?? "";
  if (!secretMatches(given, expected)) {
    return error(401, "unauthorized", "ไม่ได้รับอนุญาต");
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
    return error(413, "payload_too_large", "ข้อมูลมีขนาดใหญ่เกินไป");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return error(400, "validation_failed", "รูปแบบ JSON ไม่ถูกต้อง");
  }

  const tags = (body as { tags?: unknown })?.tags;
  if (
    !Array.isArray(tags) ||
    tags.length === 0 ||
    tags.length > MAX_TAGS ||
    !tags.every((t): t is string => typeof t === "string" && TAG_RE.test(t.normalize("NFC")))
  ) {
    return error(400, "validation_failed", 'tags ต้องเป็นอาร์เรย์ของ "posts" หรือ "post:<slug>"');
  }

  const unique = Array.from(new Set(tags.map((t) => t.normalize("NFC"))));
  for (const tag of unique) revalidateTag(tag, { expire: 0 });

  return json(200, { revalidated: true, tags: unique });
}
