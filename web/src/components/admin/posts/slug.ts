/**
 * Slug suggestion from a (usually Thai) title. Latin words are kept; Thai
 * words (split with Intl.Segmenter when available) are romanized with a
 * simplified RTGS mapping. The result is a starting point that the editor
 * can always overwrite — the slug field stays fully manual.
 */
import { SLUG_RE } from "@/lib/admin/format";

const LEAD_VOWELS = "เแโใไ";
const TONE = "่้๊๋็์ํ";

const INITIAL: Record<string, string> = {
  ก: "k", ข: "kh", ฃ: "kh", ค: "kh", ฅ: "kh", ฆ: "kh", ง: "ng", จ: "ch", ฉ: "ch", ช: "ch", ซ: "s", ฌ: "ch",
  ญ: "y", ฎ: "d", ฏ: "t", ฐ: "th", ฑ: "th", ฒ: "th", ณ: "n", ด: "d", ต: "t", ถ: "th", ท: "th", ธ: "th",
  น: "n", บ: "b", ป: "p", ผ: "ph", ฝ: "f", พ: "ph", ฟ: "f", ภ: "ph", ม: "m", ย: "y", ร: "r", ล: "l",
  ว: "w", ศ: "s", ษ: "s", ส: "s", ห: "h", ฬ: "l", อ: "", ฮ: "h",
};

const FINAL: Record<string, string> = {
  ก: "k", ข: "k", ค: "k", ฆ: "k", ง: "ng", จ: "t", ช: "t", ซ: "t", ฌ: "t", ญ: "n", ฎ: "t", ฏ: "t", ฐ: "t",
  ฑ: "t", ฒ: "t", ณ: "n", ด: "t", ต: "t", ถ: "t", ท: "t", ธ: "t", น: "n", บ: "p", ป: "p", พ: "p", ฟ: "p",
  ภ: "p", ม: "m", ย: "i", ร: "n", ล: "n", ว: "o", ศ: "t", ษ: "t", ส: "t", ฬ: "n", อ: "",
};

const VOWEL: Record<string, string> = {
  "ะ": "a", "ั": "a", "า": "a", "ำ": "am", "ิ": "i", "ี": "i", "ึ": "ue", "ื": "ue", "ุ": "u", "ู": "u",
  "ๅ": "", "ฤ": "rue", "ฦ": "lue",
};

const LEAD: Record<string, string> = { เ: "e", แ: "ae", โ: "o", ใ: "ai", ไ: "ai" };

/** Second consonant of a true cluster -> initials it can follow (กร, ปล, คว…). */
const CLUSTER: Record<string, string> = { ร: "กขคตปพผ", ล: "กขคปพผ", ว: "กขค" };

const isConsonant = (c: string | undefined) => c !== undefined && c in INITIAL;

/** Rough RTGS romanization of one Thai word. */
export function romanizeThai(word: string): string {
  const chars = [...word.normalize("NFC")].filter((c) => !TONE.includes(c) && c !== "ๆ" && c !== "ฯ");
  let out = "";
  let lead = "";
  let hasVowel = false;
  let inSyllable = false;
  let afterInitial = false;
  let initial = "";
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c >= "๐" && c <= "๙") {
      out += String(c.charCodeAt(0) - 0x0e50);
      continue;
    }
    if (LEAD_VOWELS.includes(c)) {
      if (inSyllable && !hasVowel) out += "o";
      lead = LEAD[c];
      inSyllable = false;
      continue;
    }
    if (c in VOWEL) {
      out += VOWEL[c];
      hasVowel = true;
      afterInitial = false;
      continue;
    }
    if (!isConsonant(c)) continue;
    if (!inSyllable) {
      out += INITIAL[c] + lead;
      hasVowel = lead !== "";
      afterInitial = lead === "";
      initial = c;
      lead = "";
      inSyllable = true;
      continue;
    }
    // อ after a bare initial is the vowel "o" (ต้อง -> tong).
    if (c === "อ" && !hasVowel) {
      out += "o";
      hasVowel = true;
      afterInitial = false;
      continue;
    }
    // A consonant inside a syllable: final consonant, or the start of the next one.
    const next = chars[i + 1];
    const nextIsVowel = next !== undefined && next in VOWEL && next !== "ฤ" && next !== "ฦ";
    if (!nextIsVowel) {
      // ไทย: the ย after "ai" is silent.
      const fin = c === "ย" && out.endsWith("ai") ? "" : (FINAL[c] ?? "");
      out += (hasVowel ? "" : "o") + fin;
      inSyllable = false;
      hasVowel = false;
      afterInitial = false;
      continue;
    }
    // Clusters (คว, กร, ปล…) take no inherent vowel in between.
    const cluster = afterInitial && (CLUSTER[c] ?? "").includes(initial);
    if (!hasVowel && !cluster) out += "a";
    out += INITIAL[c];
    hasVowel = false;
    afterInitial = false;
  }
  if (inSyllable && !hasVowel && out) out += "o";
  return out;
}

function words(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    const seg = new Seg("th", { granularity: "word" });
    return Array.from(seg.segment(text))
      .filter((s) => s.isWordLike)
      .map((s) => s.segment);
  }
  return text.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
}

export function slugify(title: string, maxLen = 80): string {
  const parts: string[] = [];
  for (const w of words(title.normalize("NFC"))) {
    const latin = w
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/['’]/g, "");
    const piece = /[฀-๿]/.test(w) ? romanizeThai(w) : latin;
    const clean = piece.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (clean) parts.push(clean);
  }
  let slug = "";
  for (const p of parts) {
    const next = slug ? `${slug}-${p}` : p;
    if (next.length > maxLen) break;
    slug = next;
  }
  return SLUG_RE.test(slug) ? slug : "";
}
