/**
 * Knowledge (blog) data access.
 *
 * Source of truth is the Go API (CONTRACTS.md). Every reader is a `'use cache'`
 * function tagged `posts` (+ `post:<slug>` for single posts) so the API can
 * invalidate it through POST /api/revalidate. When API_URL is unset or the API
 * fails, the bundled posts.json is served instead, so `next build` never fails
 * and SEO pages always render:
 *   - API_URL unset      -> bundle, cacheLife('max') at runtime; the short
 *                           profile below when unset during `next build`
 *   - API error/timeout  -> bundle, short inline profile so the API is retried
 *                           within ~5 minutes (expire >= 5 min keeps it in
 *                           the prerendered shell, see cacheLife docs)
 *   - API OK             -> lists cacheLife('hours'), posts cacheLife('days');
 *                           edits arrive earlier via revalidateTag
 *
 * Fallback policy when the API IS reachable:
 *   - the API is the source of truth as soon as it reports >= 1 published
 *     post (meta.total of the unfiltered list);
 *   - with ZERO published posts (fresh/empty DB) lists, categories and single
 *     posts come from the bundle, so the site never shows an empty blog;
 *   - a slug the API answers 404 for falls back to the bundle ONLY in that
 *     zero-posts case; otherwise it is a real 404 (unpublished/deleted posts
 *     must disappear, the proxy then serves their 301/410).
 * Composite helpers (featured, related, all slugs) are NOT cached themselves:
 * they only combine cached readers, so the readers' lifetimes stay in charge
 * (an explicit outer cacheLife would hide a short fallback lifetime).
 */
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { ApiError, ApiUnavailableError, apiGet } from "@/lib/api/client";
import {
  bundledCategories,
  bundledPosts,
  toSummary,
  type Category,
  type CategoryRef,
  type Post,
  type PostImage,
  type PostSummary,
} from "@/content/posts";

export type { Category, CategoryRef, Post, PostImage, PostSummary };

export const POSTS_PER_PAGE = 12;

export type PostsPage = {
  posts: PostSummary[];
  page: number;
  perPage: number;
  total: number;
  totalPages: number;
};

/* ---------------- API wire types (snake_case) ---------------- */

type ApiCover = { url: string; alt?: string | null; width?: number | null; height?: number | null } | null;
type ApiPostSeo = { noindex?: boolean | null; canonical_url?: string | null; og_image?: ApiCover };
type ApiCategoryRef = { slug: string; name: string; name_th?: string | null };
type ApiPostSummary = {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  cover: ApiCover;
  categories: ApiCategoryRef[] | null;
  author: string;
  published_at: string;
  updated_at: string;
  reading_minutes: number;
  featured: boolean;
  seo_title?: string | null;
  seo_description?: string | null;
} & ApiPostSeo;
type ApiPost = ApiPostSummary & { body_markdown: string; legacy_slugs?: string[] | null };
type ApiMeta = { page: number; per_page: number; total: number; total_pages: number };
type ApiCategory = { slug: string; name: string; name_th?: string | null; description?: string | null; post_count?: number };

/* ---------------- mapping ---------------- */

function mapCover(c: ApiCover, fallbackAlt: string): PostImage | null {
  if (!c?.url || !c.width || !c.height) return null; // no dimensions -> no CLS-safe image
  return { src: c.url, width: c.width, height: c.height, alt: c.alt?.trim() || fallbackAlt };
}

/** Only an absolute http(s) URL is a usable canonical override. */
function cleanCanonical(url: string | null | undefined): string {
  const u = url?.trim() ?? "";
  if (!u) return "";
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
  } catch {
    return "";
  }
}

function mapSummary(p: ApiPostSummary): PostSummary {
  return {
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt ?? "",
    seoTitle: p.seo_title?.trim() || p.title,
    seoDescription: p.seo_description?.trim() || p.excerpt || "",
    cover: mapCover(p.cover, p.title),
    categories: (p.categories ?? []).map((c) => ({ slug: c.slug, name: c.name, nameTh: c.name_th || c.name })),
    author: p.author,
    publishedAt: p.published_at,
    updatedAt: p.updated_at || p.published_at,
    readingMinutes: Math.max(1, Math.round(p.reading_minutes || 1)),
    featured: Boolean(p.featured),
    noindex: Boolean(p.noindex),
    canonicalUrl: cleanCanonical(p.canonical_url),
    ogImage: mapCover(p.og_image ?? null, p.title),
  };
}

function mapPost(p: ApiPost): Post {
  return { ...mapSummary(p), bodyMarkdown: p.body_markdown ?? "", legacySlugs: p.legacy_slugs ?? [] };
}

/* ---------------- helpers ---------------- */

/** Route params can arrive percent-encoded (Thai legacy slugs). */
export function normalizeSlug(slug: string): string {
  let s = slug;
  try {
    s = decodeURIComponent(slug);
  } catch {
    // malformed escape: use as-is
  }
  return s.normalize("NFC").trim();
}

function clampPage(page: number | undefined): number {
  return Number.isInteger(page) && (page as number) > 0 ? (page as number) : 1;
}

function isUnconfigured(err: unknown): boolean {
  return err instanceof ApiUnavailableError && err.reason === "unconfigured";
}

/**
 * Lifetime of a bundle fallback.
 * - API_URL unset at RUNTIME (local dev without the API): 'max', nothing to retry.
 * - API_URL unset at BUILD time (Docker/Railway builds: the private API is not
 *   reachable and API_URL is deliberately not a build arg) or an API error:
 *   short profile, so the running server replaces the prerendered bundle
 *   content with live API data within ~5 minutes instead of serving it for
 *   weeks (a 'max' prerender would hide admin-created posts after every deploy).
 */
function fallbackCacheLife(err: unknown) {
  if (isUnconfigured(err) && process.env.NEXT_PHASE !== "phase-production-build") cacheLife("max");
  else cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
}

function warnFallback(fn: string, err: unknown) {
  if (isUnconfigured(err)) return; // expected in local dev / CI without the API
  const why = err instanceof Error ? err.message : String(err);
  console.warn(`[posts] ${fn}: API failed, serving bundled posts (${why})`);
}

function bundlePage(page: number, category?: string): PostsPage {
  const list = category
    ? bundledPosts.filter((p) => p.categories.some((c) => c.slug === category))
    : bundledPosts;
  const totalPages = Math.max(1, Math.ceil(list.length / POSTS_PER_PAGE));
  const start = (page - 1) * POSTS_PER_PAGE;
  return {
    posts: list.slice(start, start + POSTS_PER_PAGE).map(toSummary),
    page,
    perPage: POSTS_PER_PAGE,
    total: list.length,
    totalPages,
  };
}

function bundlePost(slug: string): Post | null {
  return bundledPosts.find((p) => p.slug === slug || p.legacySlugs.includes(slug)) ?? null;
}

/**
 * True when the API is reachable and reports zero published posts in total
 * (fresh database) -> the bundle stands in. Any API failure here returns
 * false: the caller already got a real answer from the API and trusts it.
 */
async function apiHasNoPosts(): Promise<boolean> {
  try {
    return (await getApiPostTotal()) === 0;
  } catch {
    return false;
  }
}

async function getApiPostTotal(): Promise<number> {
  "use cache";
  cacheTag("posts");
  const res = await apiGet<{ data: ApiPostSummary[]; meta: ApiMeta }>("/api/v1/posts", {
    query: { page: 1, per_page: 1 },
  });
  cacheLife("hours");
  return res.meta.total;
}

/* ---------------- public readers ---------------- */

/** Newest-first page of published posts, optionally within one category. */
export async function getPostsPage({ page, category }: { page?: number; category?: string } = {}): Promise<PostsPage> {
  "use cache";
  cacheTag("posts");
  const p = clampPage(page);
  try {
    const res = await apiGet<{ data: ApiPostSummary[]; meta: ApiMeta }>("/api/v1/posts", {
      query: { page: p, per_page: POSTS_PER_PAGE, category },
    });
    cacheLife("hours");
    // An empty category says nothing about the API as a whole: ask for the total.
    if (res.meta.total === 0 && (!category || (await apiHasNoPosts()))) return bundlePage(p, category);
    return {
      posts: res.data.map(mapSummary),
      page: res.meta.page,
      perPage: res.meta.per_page,
      total: res.meta.total,
      totalPages: Math.max(1, res.meta.total_pages),
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cacheLife("hours");
      if (await apiHasNoPosts()) return bundlePage(p, category);
      return { posts: [], page: p, perPage: POSTS_PER_PAGE, total: 0, totalPages: 1 };
    }
    warnFallback("getPostsPage", err);
    fallbackCacheLife(err);
    return bundlePage(p, category);
  }
}

/** The post flagged `featured`, else the newest one. */
export async function getFeaturedPost(): Promise<PostSummary | null> {
  const { posts } = await getPostsPage({ page: 1 });
  return posts.find((p) => p.featured) ?? posts[0] ?? null;
}

/**
 * One post by canonical OR legacy slug (the caller redirects when
 * `post.slug !== slug`). Returns null when the post does not exist.
 */
export async function getPost(slug: string): Promise<Post | null> {
  "use cache";
  const key = normalizeSlug(slug);
  cacheTag("posts", `post:${key}`);
  try {
    const res = await apiGet<{ data: ApiPost }>(`/api/v1/posts/${encodeURIComponent(key)}`);
    const post = mapPost(res.data);
    if (post.slug !== key) cacheTag(`post:${post.slug}`);
    cacheLife("days");
    return post;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      cacheLife("days");
      return (await apiHasNoPosts()) ? bundlePost(key) : null;
    }
    warnFallback("getPost", err);
    fallbackCacheLife(err);
    return bundlePost(key);
  }
}

/** All categories incl. empty ones, with published post counts. */
export async function getCategories(): Promise<Category[]> {
  "use cache";
  cacheTag("posts");
  try {
    const res = await apiGet<{ data: ApiCategory[] }>("/api/v1/categories");
    cacheLife("hours");
    // Bundle lists are served while the API has no posts: keep counts consistent.
    if (await apiHasNoPosts()) return bundledCategories;
    return res.data.map((c) => ({
      slug: c.slug,
      name: c.name,
      nameTh: c.name_th || c.name,
      description: c.description ?? "",
      postCount: c.post_count ?? 0,
    }));
  } catch (err) {
    warnFallback("getCategories", err);
    fallbackCacheLife(err);
    return bundledCategories;
  }
}

/**
 * Slugs to prerender: every published post, plus the bundled legacy (Wix)
 * slugs so those URLs are prerendered as permanent redirects.
 */
export async function getAllPostSlugs(): Promise<string[]> {
  const slugs = new Set<string>();
  const first = await getPostsPage({ page: 1 });
  first.posts.forEach((p) => slugs.add(p.slug));
  for (let page = 2; page <= first.totalPages && page <= 50; page++) {
    (await getPostsPage({ page })).posts.forEach((p) => slugs.add(p.slug));
  }
  for (const p of bundledPosts) {
    if (!slugs.has(p.slug)) continue; // unpublished/deleted in the API
    p.legacySlugs.forEach((s) => slugs.add(s));
  }
  // cacheComponents requires >= 1 param; an empty API (fresh DB) must not break
  // the build — fall back to bundled slugs (they 404 if the API lacks them).
  if (slugs.size === 0) bundledPosts.forEach((p) => slugs.add(p.slug));
  return Array.from(slugs);
}

/** Up to `limit` posts sharing a category with `post`, topped up with the latest. */
export async function getRelatedPosts(
  post: Pick<PostSummary, "slug" | "categories">,
  limit = 3,
): Promise<PostSummary[]> {
  const picked: PostSummary[] = [];
  const add = (list: PostSummary[]) => {
    for (const p of list) {
      if (picked.length >= limit) return;
      if (p.slug !== post.slug && !picked.some((x) => x.slug === p.slug)) picked.push(p);
    }
  };
  for (const c of post.categories) {
    if (picked.length >= limit) break;
    add((await getPostsPage({ page: 1, category: c.slug })).posts);
  }
  if (picked.length < limit) add((await getPostsPage({ page: 1 })).posts);
  return picked;
}
