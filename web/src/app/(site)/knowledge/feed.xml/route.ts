/**
 * RSS 2.0 feed of the latest posts (replaces Wix /blog-feed.xml, which
 * 301-redirects here). Same cached data layer as the pages, so it is
 * invalidated by revalidateTag("posts").
 */
import { getPostsPage } from "@/lib/posts";
import { absUrl } from "@/lib/seo/jsonld";
import { site } from "@/content/site";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

async function buildFeed(): Promise<string> {
  "use cache";
  const { posts } = await getPostsPage({ page: 1 });
  const items = posts
    .map((p) => {
      const url = absUrl(`/knowledge/${p.slug}`);
      return [
        "<item>",
        `<title>${esc(p.title)}</title>`,
        `<link>${esc(url)}</link>`,
        `<guid isPermaLink="true">${esc(url)}</guid>`,
        `<pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate>`,
        `<description>${esc(p.excerpt)}</description>`,
        ...p.categories.map((c) => `<category>${esc(c.name)}</category>`),
        p.cover ? `<enclosure url="${esc(absUrl(p.cover.src))}" type="image/webp" length="0"/>` : "",
        "</item>",
      ].join("");
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${esc(`${site.name} Knowledge`)}</title>
<link>${esc(absUrl("/knowledge"))}</link>
<atom:link href="${esc(absUrl("/knowledge/feed.xml"))}" rel="self" type="application/rss+xml"/>
<description>${esc("บทความด้านแบรนด์ ธุรกิจ และการเติบโต จากทีม ECOMACROBIZ")}</description>
<language>th</language>
${items}
</channel>
</rss>`;
}

export async function GET() {
  return new Response(await buildFeed(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
