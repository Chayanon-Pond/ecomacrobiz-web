import type { NextConfig } from "next";
import { legacyPostRedirects } from "./src/content/posts";

/**
 * Legacy Wix URLs -> new routes.
 * 301 (not Next's default 308) because the brief asks for classic permanent
 * redirects that every crawler/HTTP client understands.
 * Order matters: specific post slugs (incl. percent-encoded Thai Wix slugs
 * -> new ASCII slugs) come before the generic /post/:slug fallback.
 */
const legacyRedirects: { source: string; destination: string }[] = [
  { source: "/blank", destination: "/purpose" },
  { source: "/blank-4", destination: "/solutions" },
  { source: "/blank-2", destination: "/gallery" },
  { source: "/blank-3", destination: "/how-we-work" },
  { source: "/blank-5", destination: "/contact" },
  { source: "/blog", destination: "/knowledge" },
  { source: "/blog-feed.xml", destination: "/knowledge/feed.xml" },
  { source: "/blog/categories/:category", destination: "/knowledge/category/:category" },
  { source: "/blog/page/:page(\\d+)", destination: "/knowledge?page=:page" },
  ...legacyPostRedirects(),
  { source: "/post/:slug", destination: "/knowledge/:slug" },
  // Anything else under the old Wix blog (tags, hashtags, search, ...).
  { source: "/blog/:path*", destination: "/knowledge" },
];

/** API media host for next/image (read at build time). See src/lib/media.ts. */
function mediaRemotePatterns() {
  const origin = process.env.NEXT_PUBLIC_MEDIA_ORIGIN;
  if (!origin) return [];
  try {
    const u = new URL(origin);
    return [
      {
        protocol: u.protocol.replace(":", "") as "http" | "https",
        hostname: u.hostname,
        port: u.port,
        pathname: "/media/**",
      },
    ];
  } catch {
    return [];
  }
}

/**
 * Canonical host redirect: when NEXT_PUBLIC_SITE_URL is https://www.<domain>,
 * requests for the bare apex (<domain>) are 301'd to www, path + query kept.
 * Cloudflare can do the same with a Redirect Rule; this keeps it correct even
 * if the edge rule is missing. Read at build time.
 */
function canonicalHostRedirects() {
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
    if (!u.hostname.startsWith("www.")) return [];
    const apex = u.hostname.slice(4).replace(/\./g, "\\.");
    return [
      {
        source: "/:path*",
        has: [{ type: "host" as const, value: apex }],
        destination: `${u.origin}/:path*`,
      },
    ];
  } catch {
    return [];
  }
}

/** HSTS only when the canonical site is https (never for local http builds). */
const siteIsHttps = (process.env.NEXT_PUBLIC_SITE_URL ?? "").startsWith("https://");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  // 1 year, no includeSubDomains/preload yet (mail/autodiscover subdomains are
  // Microsoft's) — tighten after launch if wanted.
  ...(siteIsHttps ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
];

const noindex = [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

const nextConfig: NextConfig = {
  // Minimal self-contained server (.next/standalone/server.js) for the Docker
  // image (web/Dockerfile). `next start` keeps working locally.
  output: "standalone",
  // The post OG route loads next/og with a runtime require (see its comment),
  // so the tracer cannot see it: ship next/og + its compiled deps explicitly.
  outputFileTracingIncludes: {
    "/knowledge/\\[slug\\]/og": [
      "./node_modules/next/og.js",
      "./node_modules/next/dist/server/og/**/*",
      "./node_modules/next/dist/compiled/@vercel/og/**/*",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    formats: ["image/avif", "image/webp"],
    qualities: [75, 85],
    remotePatterns: mediaRemotePatterns(),
  },
  async redirects() {
    return [...canonicalHostRedirects(), ...legacyRedirects].map((r) => ({ ...r, statusCode: 301 as const }));
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin", headers: noindex },
      { source: "/admin/:path*", headers: noindex },
      { source: "/api/:path*", headers: noindex },
    ];
  },
};

export default nextConfig;
