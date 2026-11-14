/**
 * Rendered-width estimate for Google result titles/snippets (desktop SERP:
 * Arial 20px titles cut at ~600px, 14px snippets ~920px per line).
 *
 * Latin runs are measured with canvas (Arial). Thai runs are approximated:
 * Google falls back to a system Thai face, so the canvas result would depend
 * on the editor's OS. Base glyphs count ~0.56em; above/below vowels and tone
 * marks combine and take no width.
 */

export const SERP_TITLE_PX = 600;
export const SERP_DESC_LINE_PX = 920;

const THAI = /[฀-๿]/;
const THAI_COMBINING = /[ัิ-ฺ็-๎]/;
const THAI_EM = 0.56;

let ctx: CanvasRenderingContext2D | null | undefined;

function measureLatin(text: string, px: number): number {
  if (!text) return 0;
  if (ctx === undefined && typeof document !== "undefined") ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * px * 0.5;
  ctx.font = `${px}px Arial`;
  return ctx.measureText(text).width;
}

export function serpWidth(text: string, px = 20): number {
  let width = 0;
  let latin = "";
  for (const ch of text.normalize("NFC")) {
    if (THAI.test(ch)) {
      width += measureLatin(latin, px);
      latin = "";
      if (!THAI_COMBINING.test(ch)) width += px * THAI_EM;
    } else {
      latin += ch;
    }
  }
  return Math.round(width + measureLatin(latin, px));
}

/** Visible characters (Thai combining marks do not count as a character). */
export function visibleLength(text: string): number {
  let n = 0;
  for (const ch of text.normalize("NFC")) if (!THAI_COMBINING.test(ch)) n++;
  return n;
}

export const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ecomacrobiz.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
