/**
 * The visitor IP we forward to the Go API as a single-value X-Forwarded-For
 * (the API trusts XFF only from TRUSTED_PROXIES = this Next server).
 *
 * Never forward the raw incoming chain: its left-most entries are
 * client-controlled, so the API's per-IP rate limit could be bypassed.
 *  1. CLIENT_IP_HEADER (e.g. "cf-connecting-ip" behind Cloudflare) — set it
 *     only when every request really passes through that proxy.
 *  2. Otherwise the RIGHT-most X-Forwarded-For entry (added by the nearest
 *     proxy in front of Next, e.g. Railway's edge).
 *  3. x-real-ip.
 */
export function clientIp(h: Headers): string | null {
  const custom = process.env.CLIENT_IP_HEADER?.trim().toLowerCase();
  if (custom) {
    const v = h.get(custom)?.split(",")[0]?.trim();
    if (v) return v;
  }
  const chain = (h.get("x-forwarded-for") ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (chain.length) return chain[chain.length - 1];
  return h.get("x-real-ip")?.trim() || null;
}
