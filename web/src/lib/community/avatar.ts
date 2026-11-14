/**
 * Initials avatar: deterministic colour from the member id, 1–2 initials
 * from the display name (Thai-aware: a leading Thai vowel/tone mark is
 * skipped so "เอก" -> "อ" is avoided in favour of the first consonant).
 * Shared by the server-rendered comments and every client component.
 */

/** Dark-UI friendly backgrounds (white text passes 4.5:1 on all of them). */
export const AVATAR_COLORS = [
  "#1f4fd8", // accent blue
  "#7c3aed",
  "#be185d",
  "#b45309",
  "#047857",
  "#0e7490",
  "#4d4dbf",
  "#9f1239",
] as const;

/** FNV-1a 32-bit — stable across server and browser. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function avatarColor(id: string): string {
  return AVATAR_COLORS[hash(id) % AVATAR_COLORS.length];
}

// Thai leading vowels (เ แ โ ใ ไ) and combining marks are not good initials.
const SKIP = /[เ-ไัิ-ฺ็-๎\s"'“”‘’()[\]{}.,!?@#_-]/u;

function firstGlyph(word: string): string {
  for (const ch of word) {
    if (!SKIP.test(ch)) return ch.toLocaleUpperCase("th-TH");
  }
  return "";
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const a = firstGlyph(words[0]);
  const b = words.length > 1 ? firstGlyph(words[words.length - 1]) : "";
  // Two Latin initials ("JD"); Thai (or mixed "ทดสอบ W") names read better with one glyph.
  const isLatin = /^[A-Za-z0-9]$/.test(a) && /^[A-Za-z0-9]?$/.test(b);
  return (isLatin ? a + b : a) || "?";
}
