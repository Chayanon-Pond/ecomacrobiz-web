import type { MetadataRoute } from "next";
import { site } from "@/content/site";
import { getAllPostSlugs, getCategories, getPost } from "@/lib/posts";

/**
 * Public pages + every published post + every non-empty category.
 * Excludes /admin, /api and /privacy (noindex until legal approval).
 */
const staticPages: { path: string; priority: number; changeFrequency: "weekly" | "monthly" }[] = [
  { path: "/", priority: 1, changeFrequency: "monthly" },
  { path: "/purpose", priority: 0.8, changeFrequency: "monthly" },
  { path: "/solutions", priority: 0.9, changeFrequency: "monthly" },
  { path: "/gallery", priority: 0.7, changeFrequency: "monthly" },
  { path: "/how-we-work", priority: 0.8, changeFrequency: "monthly" },
  { path: "/knowledge", priority: 0.8, changeFrequency: "weekly" },
  { path: "/contact", priority: 0.8, changeFrequency: "monthly" },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = site.url.replace(/\/$/, "");
  const [slugs, categories] = await Promise.all([getAllPostSlugs(), getCategories()]);

  const posts = (await Promise.all(slugs.map((s) => getPost(s))))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    // getAllPostSlugs also returns legacy slugs; keep canonical entries once.
    .filter((p, i, all) => all.findIndex((q) => q.slug === p.slug) === i);

  const latest = posts.reduce<string | undefined>(
    (acc, p) => (!acc || p.updatedAt > acc ? p.updatedAt : acc),
    undefined,
  );

  return [
    ...staticPages.map((p) => ({
      url: `${base}${p.path === "/" ? "/" : p.path}`,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
      ...(p.path === "/knowledge" && latest ? { lastModified: latest } : {}),
    })),
    ...categories
      .filter((c) => c.postCount > 0)
      .map((c) => {
        const lm = posts
          .filter((p) => p.categories.some((pc) => pc.slug === c.slug))
          .reduce<string | undefined>((acc, p) => (!acc || p.updatedAt > acc ? p.updatedAt : acc), undefined);
        return {
          url: `${base}/knowledge/category/${c.slug}`,
          changeFrequency: "weekly" as const,
          priority: 0.6,
          ...(lm ? { lastModified: lm } : {}),
        };
      }),
    ...posts.map((p) => ({
      url: `${base}/knowledge/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
