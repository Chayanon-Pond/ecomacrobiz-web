/**
 * Which image URLs may go through the Next image optimizer.
 * - Local /public paths: always.
 * - API media (absolute URLs) only when they live under NEXT_PUBLIC_MEDIA_ORIGIN,
 *   which next.config.ts also registers in images.remotePatterns (/media/**).
 *   Anything else is rendered unoptimized rather than throwing.
 */
const MEDIA_ORIGIN = (process.env.NEXT_PUBLIC_MEDIA_ORIGIN ?? "").replace(/\/$/, "");

export function isOptimizableImage(src: string): boolean {
  if (src.startsWith("/") && !src.startsWith("//")) return true;
  return MEDIA_ORIGIN !== "" && src.startsWith(`${MEDIA_ORIGIN}/media/`);
}
