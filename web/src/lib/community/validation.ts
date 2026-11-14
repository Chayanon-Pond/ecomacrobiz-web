/**
 * Display name + e-mail checks for the member forms. Mirrors the API
 * (service/community_text.go DisplayNameProblem, service/contact.go
 * ValidEmail) so most mistakes are caught on blur; the server stays final.
 */

export const DISPLAY_NAME_MIN = 2;
export const DISPLAY_NAME_MAX = 40;
export const EMAIL_MAX = 254;

const RESERVED = ["admin", "administrator", "ecomacrobiz", "moderator", "แอดมิน", "ผู้ดูแลระบบ", "ผู้ใช้ที่ลบบัญชี"];

/** NFC, control/format characters removed, inner whitespace collapsed, trimmed. */
export function cleanDisplayName(s: string): string {
  return s
    .normalize("NFC")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

export function displayNameProblem(raw: string): string | null {
  const name = cleanDisplayName(raw);
  if (!name) return "กรุณากรอกชื่อที่แสดง";
  const n = Array.from(name).length;
  if (n < DISPLAY_NAME_MIN || n > DISPLAY_NAME_MAX) return `ชื่อที่แสดงต้องมี ${DISPLAY_NAME_MIN}-${DISPLAY_NAME_MAX} ตัวอักษร`;
  if (!/[\p{L}\p{N}]/u.test(name)) return "ชื่อที่แสดงต้องมีตัวอักษรหรือตัวเลข";
  const lower = name.toLowerCase();
  if (/[@<>]/.test(name) || /https?:\/\//i.test(name) || lower.includes("www.")) return "ชื่อที่แสดงห้ามมีอีเมลหรือลิงก์";
  if (RESERVED.some((r) => r.toLowerCase() === lower)) return "ไม่สามารถใช้ชื่อนี้ได้";
  return null;
}

/** Same normalization as the API: trim, NFC, lower-case. */
export function normalizeEmail(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  const s = normalizeEmail(raw);
  if (!s || s.length > EMAIL_MAX || /[\s<>"]/.test(s)) return false;
  const at = s.lastIndexOf("@");
  if (at <= 0) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (local.length > 64 || local.includes("@")) return false;
  if (!domain.includes(".") || domain.startsWith(".") || domain.endsWith(".") || domain.includes("..")) return false;
  return /^[^@]+$/.test(domain);
}

export function emailProblem(raw: string): string | null {
  if (!raw.trim()) return "กรุณากรอกอีเมล";
  return isValidEmail(raw) ? null : "รูปแบบอีเมลไม่ถูกต้อง";
}
