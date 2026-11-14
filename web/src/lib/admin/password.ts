/** Client-side password guidance (the API enforces 12..72 bytes). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX_BYTES = 72;

export function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

export type Strength = { score: 0 | 1 | 2 | 3 | 4; label: string; tone: "danger" | "warning" | "info" | "success" };

/** Rough heuristic: length + character variety, penalising repeats/sequences. */
export function passwordStrength(pw: string): Strength {
  if (!pw) return { score: 0, label: "", tone: "danger" };
  let score = 0;
  if (pw.length >= PASSWORD_MIN) score++;
  if (pw.length >= 16) score++;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds >= 3) score++;
  if (kinds === 4 || pw.length >= 20) score++;
  if (/(.)\1{3,}/.test(pw) || /^(?:0123|1234|abcd|qwer|password)/i.test(pw)) score = Math.max(0, score - 2);
  if (pw.length < PASSWORD_MIN) score = Math.min(score, 1);
  const s = Math.min(4, score) as Strength["score"];
  const map: Record<number, Omit<Strength, "score">> = {
    0: { label: "อ่อนมาก", tone: "danger" },
    1: { label: "อ่อน", tone: "danger" },
    2: { label: "พอใช้", tone: "warning" },
    3: { label: "ดี", tone: "info" },
    4: { label: "แข็งแรงมาก", tone: "success" },
  };
  return { score: s, ...map[s] };
}

/** Returns a Thai error or null. */
export function validateNewPassword(pw: string, confirm: string): { password?: string; confirm?: string } {
  const e: { password?: string; confirm?: string } = {};
  if (pw.length < PASSWORD_MIN) e.password = `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN} ตัวอักษร`;
  else if (byteLength(pw) > PASSWORD_MAX_BYTES) e.password = "รหัสผ่านยาวเกินไป (สูงสุด 72 ไบต์)";
  if (!e.password && pw !== confirm) e.confirm = "รหัสผ่านทั้งสองช่องไม่ตรงกัน";
  return e;
}
