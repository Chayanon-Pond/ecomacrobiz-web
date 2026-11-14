/**
 * Managed redirects (CONTRACT-SEO.md): GET ${API_URL}/api/v1/redirects ->
 * { data: [{ from, to|null, status: 301|410 }] }, served by src/proxy.ts.
 *
 * The map is kept in process memory (Proxy cannot use 'use cache'):
 *   - first lookup loads it (bounded by FETCH_TIMEOUT_MS);
 *   - after TTL_MS it is refreshed in the background, the stale map keeps
 *     answering, so a normal page request never waits on the API;
 *   - POST /api/revalidate with tag `redirects` calls invalidateRedirects():
 *     the NEXT lookup waits for a fresh map, so a just-unpublished post
 *     answers 410/301 immediately. The store lives on globalThis because the
 *     Proxy and the route handlers are separate bundles in the same process.
 * Fails open: API unset/down/garbage -> no redirect (never a 500); a failed
 * refresh keeps the last good map and retries after RETRY_MS.
 * No chains: the API flattens, and the proxy resolves exactly one hop.
 */

export type RedirectRule = { from: string; to: string | null; status: 301 | 410 };

export const TTL_MS = 60_000;
const RETRY_MS = 10_000;
const FETCH_TIMEOUT_MS = 1_500;
const MAX_RULES = 50_000;

type Store = {
  map: Map<string, RedirectRule> | null;
  /** epoch ms after which the map is refreshed in the background */
  freshUntil: number;
  /** set by invalidateRedirects(): next lookup waits for a refresh */
  invalidated: boolean;
  inflight: Promise<void> | null;
};

const KEY = Symbol.for("escoma.redirects.store");

function store(): Store {
  const g = globalThis as typeof globalThis & { [KEY]?: Store };
  g[KEY] ??= { map: null, freshUntil: 0, invalidated: false, inflight: null };
  return g[KEY];
}

/** Called by /api/revalidate when the API sends tag `redirects`. */
export function invalidateRedirects(): void {
  store().invalidated = true;
}

/**
 * Canonical lookup key: percent-decoded, NFC, no trailing slash (except "/").
 * Same normalisation as the API applies to from_path.
 */
export function normalizeRedirectPath(pathname: string): string {
  let p = pathname;
  try {
    p = decodeURIComponent(pathname);
  } catch {
    // malformed escape: compare as-is
  }
  p = p.normalize("NFC");
  if (p.length > 1) p = p.replace(/\/+$/, "") || "/";
  return p;
}

/** Accepts only well-formed rules; anything else is dropped (fail open). */
export function parseRedirects(body: unknown): Map<string, RedirectRule> {
  const map = new Map<string, RedirectRule>();
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("redirects: missing data array");
  for (const raw of data.slice(0, MAX_RULES)) {
    const r = raw as { from?: unknown; to?: unknown; status?: unknown };
    if (typeof r.from !== "string" || !r.from.startsWith("/")) continue;
    const from = normalizeRedirectPath(r.from);
    if (r.status === 410) {
      map.set(from, { from, to: null, status: 410 });
    } else if (r.status === 301 && typeof r.to === "string" && isValidTarget(r.to)) {
      if (normalizeRedirectPath(r.to) === from) continue; // self-loop
      map.set(from, { from, to: r.to, status: 301 });
    }
  }
  return map;
}

function isValidTarget(to: string): boolean {
  if (to.startsWith("/")) return !to.startsWith("//") && !to.includes("\\");
  try {
    const u = new URL(to);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function apiBase(): string | null {
  const url = process.env.API_URL?.trim();
  return url ? url.replace(/\/+$/, "") : null;
}

async function refresh(s: Store): Promise<void> {
  const base = apiBase();
  if (!base) {
    s.map = new Map();
    s.freshUntil = Date.now() + TTL_MS;
    return;
  }
  try {
    const res = await fetch(`${base}/api/v1/redirects`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: "no-store",
    });
    if (res.status === 404) {
      // API without the endpoint (older build): nothing to serve, no log spam.
      s.map = new Map();
      s.freshUntil = Date.now() + TTL_MS;
      return;
    }
    if (!res.ok) throw new Error(`redirects: API responded ${res.status}`);
    s.map = parseRedirects(await res.json());
    s.freshUntil = Date.now() + TTL_MS;
  } catch (err) {
    // Keep the last good map (or none) and retry soon.
    s.freshUntil = Date.now() + RETRY_MS;
    console.warn(`[redirects] refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startRefresh(s: Store): Promise<void> {
  if (!s.inflight) {
    s.invalidated = false;
    s.inflight = refresh(s).finally(() => {
      s.inflight = null;
    });
  }
  return s.inflight;
}

/** The rule for `pathname` (raw, percent-encoded) or null. Never throws. */
export async function lookupRedirect(pathname: string): Promise<RedirectRule | null> {
  try {
    const s = store();
    if (s.map === null || s.invalidated) {
      await startRefresh(s);
    } else if (Date.now() >= s.freshUntil) {
      void startRefresh(s);
    }
    return s.map?.get(normalizeRedirectPath(pathname)) ?? null;
  } catch {
    return null;
  }
}

/** Test hook: forget the in-memory map. */
export function resetRedirectsForTests(): void {
  const s = store();
  s.map = null;
  s.freshUntil = 0;
  s.invalidated = false;
  s.inflight = null;
}

/** Small branded page for 410 Gone (no external assets, noindex). */
export function goneHtml(): string {
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>หน้านี้ถูกนำออกแล้ว | ECOMACROBIZ</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#050507;color:#f5f5f7;
font-family:"IBM Plex Sans Thai","Noto Sans Thai",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.75}
main{max-width:34rem;text-align:center}
.mark{font:600 .75rem/1 system-ui,sans-serif;letter-spacing:.18em;color:#7b8fff;text-transform:uppercase}
h1{margin:16px 0 8px;font-size:clamp(1.6rem,5vw,2.25rem);line-height:1.3}
p{margin:0;color:#a3a3ad}
nav{margin-top:28px;display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:999px;text-decoration:none;
color:#f5f5f7;border:1px solid rgba(255,255,255,.18)}
a.primary{background:#0f34ff;border-color:#0f34ff}
a:focus-visible{outline:2px solid #7b8fff;outline-offset:3px}
</style>
</head>
<body>
<main>
<p class="mark">410 · ECOMACROBIZ</p>
<h1>หน้านี้ถูกนำออกแล้ว</h1>
<p>เนื้อหาที่คุณกำลังมองหาไม่มีให้บริการอีกต่อไป ลองอ่านบทความล่าสุดของเราแทนได้</p>
<nav><a class="primary" href="/knowledge">ดูบทความทั้งหมด</a><a href="/">กลับหน้าแรก</a></nav>
</main>
</body>
</html>`;
}
