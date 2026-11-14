/**
 * Member password rules (mirror of api/internal/vault CheckPassword) and a
 * client-only strength meter. The rules here are a convenience for the form;
 * the server's answer is final (it also rejects its embedded common-password
 * list, which the browser does not ship).
 */

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export type PasswordContext = { email?: string; displayName?: string };

/** Length in code points (the API counts runes, not UTF-16 units). */
export function runeCount(s: string): number {
  return Array.from(s).length;
}

function normalizeEmail(s: string): string {
  return s.trim().normalize("NFC").toLowerCase();
}

/** Equal (case-insensitive, trimmed) to the e-mail, its local part or the display name. */
export function isPersonalPassword(pw: string, ctx: PasswordContext = {}): boolean {
  const p = pw.trim().toLowerCase();
  if (!p) return false;
  const email = normalizeEmail(ctx.email ?? "");
  const local = email.split("@")[0] ?? "";
  const name = (ctx.displayName ?? "").trim().toLowerCase();
  return [email, local, name].some((s) => s !== "" && s === p);
}

export const PASSWORD_MESSAGES = {
  required: "กรุณากรอกรหัสผ่าน",
  tooShort: `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`,
  tooLong: `รหัสผ่านต้องไม่เกิน ${PASSWORD_MAX} ตัวอักษร`,
  personal: "รหัสผ่านต้องไม่เหมือนอีเมลหรือชื่อที่แสดง",
  mismatch: "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
} as const;

/** Thai message for the first broken rule, or null when the client-side rules pass. */
export function passwordProblem(pw: string, ctx: PasswordContext = {}): string | null {
  if (pw === "") return PASSWORD_MESSAGES.required;
  const n = runeCount(pw);
  if (n < PASSWORD_MIN) return PASSWORD_MESSAGES.tooShort;
  if (n > PASSWORD_MAX) return PASSWORD_MESSAGES.tooLong;
  if (isPersonalPassword(pw, ctx)) return PASSWORD_MESSAGES.personal;
  return null;
}

export type PasswordRule = { id: "length" | "personal"; label: string; ok: boolean };

/** Checklist shown under the field. */
export function passwordRules(pw: string, ctx: PasswordContext = {}): PasswordRule[] {
  const n = runeCount(pw);
  return [
    { id: "length", label: `${PASSWORD_MIN}–${PASSWORD_MAX} ตัวอักษร`, ok: n >= PASSWORD_MIN && n <= PASSWORD_MAX },
    { id: "personal", label: "ไม่ซ้ำกับอีเมลหรือชื่อที่แสดง", ok: pw !== "" && !isPersonalPassword(pw, ctx) },
  ];
}

// A few of the most common choices, so the meter does not praise them; the
// API's full list is authoritative.
const WEAK = [
  "password",
  "passw0rd",
  "qwerty",
  "letmein",
  "iloveyou",
  "admin",
  "welcome",
  "abc123",
  "123456",
  "football",
  "monkey",
  "dragon",
  "sunshine",
  "princess",
];

export type StrengthScore = 0 | 1 | 2 | 3 | 4;
export const STRENGTH_LABELS = ["อ่อนมาก", "อ่อน", "พอใช้", "ดี", "แข็งแรงมาก"] as const;

/**
 * Rough entropy estimate: character pool × "effective" length, where runs
 * (aaaa) and straight sequences (abcd, 4321) count as one character.
 */
export function passwordStrength(pw: string, ctx: PasswordContext = {}): { score: StrengthScore; label: string } {
  if (!pw) return { score: 0, label: "" };
  const chars = Array.from(pw);
  const lower = pw.toLowerCase();
  if (isPersonalPassword(pw, ctx)) return { score: 0, label: STRENGTH_LABELS[0] };

  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[ !-/:-@[-`{-~]/.test(pw)) pool += 33;
  if (/[^\x00-\x7f]/.test(pw)) pool += 60; // Thai and other scripts

  let effective = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i].codePointAt(0)!;
    const prev = i > 0 ? chars[i - 1].codePointAt(0)! : -10;
    if (c === prev || c === prev + 1 || c === prev - 1) effective += 0.25;
    else effective += 1;
  }
  const unique = new Set(chars).size;
  effective = Math.min(effective, unique * 2);

  let bits = effective * Math.log2(Math.max(pool, 2));
  if (WEAK.some((w) => lower.includes(w))) bits = Math.min(bits, 30);

  let score: StrengthScore = bits < 30 ? 0 : bits < 45 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  if (runeCount(pw) < PASSWORD_MIN && score > 1) score = 1;
  return { score, label: STRENGTH_LABELS[score] };
}
