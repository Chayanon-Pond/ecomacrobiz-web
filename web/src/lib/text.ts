/**
 * Split text into word segments. Thai has no spaces between words, so we use
 * Intl.Segmenter (ICU dictionary). Run on the SERVER only and pass the result
 * to client components — browser and Node ICU data can differ, which would
 * cause hydration mismatches.
 */
export function segmentWords(text: string, locale = "th"): string[] {
  if (typeof Intl === "undefined" || !("Segmenter" in Intl)) {
    return text.split(/(\s+)/).filter(Boolean);
  }
  const segmenter = new Intl.Segmenter(locale, { granularity: "word" });
  return Array.from(segmenter.segment(text), (s) => s.segment);
}
