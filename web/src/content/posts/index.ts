/**
 * Blog bundle migrated from the Wix blog (9 posts, 4 categories).
 *
 * posts.json is the CONTRACTS.md "post bundle": the web fallback when the Go
 * API is unset/unreachable, and the seed for the API database. Pages never
 * import it directly — they go through src/lib/posts.ts, which prefers the API.
 */
import bundle from "./posts.json";

export type Category = {
  slug: string;
  /** Display name as on Wix (English) */
  name: string;
  nameTh: string;
  description: string;
  postCount: number;
};

export type CategoryRef = Pick<Category, "slug" | "name" | "nameTh">;

export type PostImage = { src: string; width: number; height: number; alt: string };

export type PostSummary = {
  slug: string;
  title: string;
  excerpt: string;
  seoTitle: string;
  seoDescription: string;
  cover: PostImage | null;
  categories: CategoryRef[];
  author: string;
  /** ISO 8601 */
  publishedAt: string;
  /** ISO 8601 */
  updatedAt: string;
  readingMinutes: number;
  featured: boolean;
  /** Per-post robots noindex (still listed on /knowledge, kept out of the sitemap). */
  noindex: boolean;
  /** Absolute canonical URL override; "" = the post's own URL. */
  canonicalUrl: string;
  /** Explicit social-share image; wins over the cover for og:image. */
  ogImage: PostImage | null;
};

export type Post = PostSummary & {
  bodyMarkdown: string;
  /** Old Wix slugs (decoded) that should redirect to `slug`. */
  legacySlugs: string[];
};

/** Shape of posts.json (category slugs instead of refs). */
type SeoFields = "noindex" | "canonicalUrl" | "ogImage";
type BundlePost = Omit<Post, "categories" | SeoFields> & Partial<Pick<Post, SeoFields>> & { categories: string[] };
type BundleCategory = Omit<Category, "postCount">;
type Bundle = { categories: BundleCategory[]; posts: BundlePost[] };

const data = bundle as Bundle;

function toRef(slug: string): CategoryRef {
  const c = data.categories.find((x) => x.slug === slug);
  return c ? { slug: c.slug, name: c.name, nameTh: c.nameTh } : { slug, name: slug, nameTh: slug };
}

/** Newest first (published_at desc), same order as the API. */
export const bundledPosts: Post[] = data.posts
  .map((p) => ({
    noindex: false,
    canonicalUrl: "",
    ogImage: null,
    ...p,
    categories: p.categories.map(toRef),
  }))
  .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

export const bundledCategories: Category[] = data.categories.map((c) => ({
  ...c,
  postCount: bundledPosts.filter((p) => p.categories.some((x) => x.slug === c.slug)).length,
}));

export function toSummary(p: Post): PostSummary {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { bodyMarkdown, legacySlugs, ...summary } = p;
  return summary;
}

/**
 * Legacy Wix URLs (/post/<decoded slug>) -> canonical /knowledge/<slug>.
 * For next.config.ts redirects (owner: Bob) so old links 301 in one hop.
 */
export function legacyPostRedirects(): { source: string; destination: string }[] {
  return bundledPosts.flatMap((p) =>
    Array.from(new Set([p.slug, ...p.legacySlugs])).map((legacy) => ({
      source: `/post/${encodeURIComponent(legacy)}`,
      destination: `/knowledge/${p.slug}`,
    })),
  );
}
