/**
 * Knowledge display helpers. Dates are formatted on the SERVER only
 * (th-TH, Buddhist calendar, Asia/Bangkok) and passed down as strings, so
 * browser ICU differences can never cause a hydration mismatch.
 */

const longDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

const shortDate = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Bangkok",
});

/** "9 พฤศจิกายน 2569" (long) or "9 พ.ย. 2569" (short). */
export function formatThaiDate(iso: string, style: "long" | "short" = "short"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return (style === "long" ? longDate : shortDate).format(d);
}

/** Same calendar day in Bangkok? (hide "updated" when it equals published) */
export function sameThaiDay(a: string, b: string): boolean {
  return formatThaiDate(a, "long") === formatThaiDate(b, "long");
}

export function readingLabel(minutes: number): string {
  return `อ่าน ${minutes} นาที`;
}

/** True when next/image may optimize `src` (local or allow-listed API media). */
export { isOptimizableImage as isLocalImage } from "@/lib/media";

export function postHref(slug: string): string {
  return `/knowledge/${slug}`;
}

export function categoryHref(slug: string): string {
  return `/knowledge/category/${slug}`;
}

/** Site-wide OG image (app/opengraph-image.jpg). A page-level `openGraph`
 *  object replaces the root one, so pages without their own image restate it. */
export const defaultOgImage = {
  url: "/opengraph-image.jpg",
  width: 1200,
  height: 630,
  alt: "ECOMACROBIZ — ที่ปรึกษาแบรนด์ กลยุทธ์ และระบบดิจิทัล B2B",
};
