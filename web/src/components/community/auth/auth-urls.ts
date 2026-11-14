/**
 * Pure helpers for the member auth flows: `next` paths for the Google
 * round-trip, `#token=` / `#community=` fragments, Thai messages for OAuth
 * outcomes and rate-limit waits. No DOM access, so they are unit-tested.
 */
import type { PendingAction } from "@/lib/community/types";

/** Same bound as the API's next_path validation. */
export const NEXT_MAX = 512;

/** A same-origin path (`/x?y`) or `fallback`. Rejects `//host`, `\`, control chars, over-long values. */
export function safeNextPath(raw: string | null | undefined, fallback = "/"): string {
  if (!raw || raw.length > NEXT_MAX) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let url: URL;
  try {
    url = new URL(raw, "http://next.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://next.invalid") return fallback;
  const out = `${url.pathname}${url.search}`;
  return out.length > NEXT_MAX ? fallback : out;
}

/** Path + search of the current page (never the fragment). */
export function currentNextPath(loc: { pathname: string; search: string }): string {
  return safeNextPath(`${loc.pathname}${loc.search}`);
}

/**
 * Google start URL (same-origin proxy). `consent` = the visitor saw the
 * consent notice: required to create a NEW account. The account page's
 * "connect Google" passes false so a Google account with another e-mail
 * fails with `error-consent` instead of silently creating a second member.
 */
export function googleStartUrl(next: string, consent = true): string {
  const qs = new URLSearchParams({ next: safeNextPath(next) });
  if (consent) qs.set("consent", "1");
  return `/api/community/auth/google/start?${qs.toString()}`;
}

/** `#a=1&b=2` -> {a:"1", b:"2"}. */
export function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return out;
  for (const [k, v] of new URLSearchParams(raw)) out[k] = v;
  return out;
}

/** The e-mailed / link token from `#token=…` (base64url, 16..256 chars), else null. */
export function readFragmentToken(hash: string): string | null {
  const t = parseFragment(hash).token;
  return t && /^[A-Za-z0-9_-]{16,256}$/.test(t) ? t : null;
}

export type OAuthResult = { kind: "signed-in" } | { kind: "link-required" } | { kind: "error"; code: string };

/** `#community=<outcome>` after the Google callback, or null. */
export function readOAuthOutcome(hash: string): OAuthResult | null {
  const v = parseFragment(hash).community;
  if (!v) return null;
  if (v === "signed-in") return { kind: "signed-in" };
  if (v === "link-required") return { kind: "link-required" };
  if (v.startsWith("error-")) {
    const code = v.slice(6);
    return { kind: "error", code: /^[a-z_-]{1,32}$/.test(code) ? code : "internal" };
  }
  return null;
}

const OAUTH_ERRORS: Record<string, string> = {
  state: "การเข้าสู่ระบบด้วย Google หมดเวลาหรือไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
  denied: "คุณยกเลิกการเข้าสู่ระบบด้วย Google",
  provider: "ไม่สามารถเชื่อมต่อกับ Google ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง",
  token: "ยืนยันตัวตนกับ Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  unverified: "อีเมลของบัญชี Google นี้ยังไม่ได้รับการยืนยัน กรุณาใช้บัญชีอื่น",
  banned: "บัญชีของคุณถูกระงับการใช้งานชุมชน",
  consent: "กรุณายอมรับแนวทางชุมชนและนโยบายความเป็นส่วนตัวก่อน แล้วลองเข้าสู่ระบบด้วย Google อีกครั้ง",
  conflict: "บัญชีนี้เชื่อมต่อกับบัญชี Google อื่นอยู่แล้ว",
  internal: "เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง",
};

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? OAUTH_ERRORS.internal;
}

/** "42 วินาที" / "3 นาที" for a Retry-After value in seconds. */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 90) return `${s} วินาที`;
  return `${Math.ceil(s / 60)} นาที`;
}

/** Article to return to after a detour (link-google page), or null. */
export function pendingActionHref(action: PendingAction | null): string | null {
  if (!action || action.kind === "none") return null;
  const slug = action.slug;
  if (!slug || !/^[\p{L}\p{N}_-]{1,200}$/u.test(slug)) return null;
  return `/knowledge/${encodeURIComponent(slug)}`;
}
