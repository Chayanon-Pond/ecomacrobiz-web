/**
 * Knowledge fallback policy (src/lib/posts.ts): the API is the source of
 * truth once it reports >= 1 published post; the bundle stands in only while
 * the API has zero posts (or is unreachable).
 */
import { after, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import path from "node:path";

class ApiError extends Error {
  status: number;
  constructor(status: number) {
    super(`API responded ${status}`);
    this.status = status;
  }
}
class ApiUnavailableError extends Error {
  reason: string;
  constructor(reason: string) {
    super(`API unavailable (${reason})`);
    this.reason = reason;
  }
}

type Handler = (path: string, query: Record<string, unknown>) => unknown;
let handler: Handler = () => {
  throw new ApiUnavailableError("unconfigured");
};

const clientUrl = pathToFileURL(path.resolve(import.meta.dirname, "../src/lib/api/client.ts")).href;
mock.module(clientUrl, {
  namedExports: {
    ApiError,
    ApiUnavailableError,
    apiGet: async (p: string, opts: { query?: Record<string, unknown> } = {}) => handler(p, opts.query ?? {}),
  },
});
mock.module("next/cache", { namedExports: { cacheLife: () => {}, cacheTag: () => {} } });

const posts = await import("../src/lib/posts");
const { bundledPosts } = await import("../src/content/posts");

function apiPost(slug: string, extra: Record<string, unknown> = {}) {
  return {
    id: `id-${slug}`,
    slug,
    title: `Title ${slug}`,
    excerpt: "excerpt",
    cover: null,
    categories: [{ slug: "brand-insight", name: "Brand Insight", name_th: "แบรนด์" }],
    author: "ECOMACROBIZ",
    published_at: "2026-11-01T03:00:00Z",
    updated_at: "2026-11-02T03:00:00Z",
    reading_minutes: 4,
    featured: false,
    body_markdown: "# hi",
    ...extra,
  };
}

function list(items: ReturnType<typeof apiPost>[], total = items.length) {
  return { data: items, meta: { page: 1, per_page: 12, total, total_pages: Math.max(1, Math.ceil(total / 12)) } };
}

const apiCategories = {
  data: [{ slug: "brand-insight", name: "Brand Insight", name_th: "แบรนด์", description: "", post_count: 1 }],
};

after(() => mock.restoreAll());

describe("API has published posts (source of truth)", () => {
  beforeEach(() => {
    handler = (p, q) => {
      if (p === "/api/v1/posts") return q.category === "empty-cat" ? list([], 0) : list([apiPost("live-one")], 1);
      if (p === "/api/v1/posts/live-one") return { data: apiPost("live-one") };
      if (p === "/api/v1/categories") return apiCategories;
      throw new ApiError(404);
    };
  });

  test("list comes from the API", async () => {
    const page = await posts.getPostsPage({ page: 1 });
    assert.deepEqual(
      page.posts.map((p) => p.slug),
      ["live-one"],
    );
    assert.equal(page.total, 1);
  });

  test("an empty category stays empty (no bundle mixing)", async () => {
    const page = await posts.getPostsPage({ page: 1, category: "empty-cat" });
    assert.equal(page.posts.length, 0);
  });

  test("a slug the API 404s is a real 404 even if the bundle has it", async () => {
    assert.equal(await posts.getPost(bundledPosts[0].slug), null);
  });

  test("SEO fields are mapped", async () => {
    handler = (p) => {
      if (p === "/api/v1/posts/live-one")
        return {
          data: apiPost("live-one", {
            noindex: true,
            canonical_url: "https://example.org/original",
            og_image: { url: "https://cdn.example/og.png", alt: "ภาพ", width: 1200, height: 630 },
          }),
        };
      return list([apiPost("live-one")], 1);
    };
    const post = await posts.getPost("live-one");
    assert.ok(post);
    assert.equal(post.noindex, true);
    assert.equal(post.canonicalUrl, "https://example.org/original");
    assert.deepEqual(post.ogImage, { src: "https://cdn.example/og.png", width: 1200, height: 630, alt: "ภาพ" });
  });

  test("a non-http canonical override is ignored", async () => {
    handler = (p) => {
      if (p === "/api/v1/posts/live-one") return { data: apiPost("live-one", { canonical_url: "javascript:alert(1)" }) };
      return list([apiPost("live-one")], 1);
    };
    assert.equal((await posts.getPost("live-one"))?.canonicalUrl, "");
  });

  test("categories come from the API", async () => {
    const cats = await posts.getCategories();
    assert.deepEqual(
      cats.map((c) => c.slug),
      ["brand-insight"],
    );
  });

  test("featured post and prerender slugs only reference API posts", async () => {
    assert.equal((await posts.getFeaturedPost())?.slug, "live-one");
    assert.deepEqual(await posts.getAllPostSlugs(), ["live-one"]);
  });
});

describe("API reachable but zero published posts", () => {
  beforeEach(() => {
    handler = (p) => {
      if (p === "/api/v1/posts") return list([], 0);
      if (p === "/api/v1/categories") return { data: [] };
      throw new ApiError(404);
    };
  });

  test("list falls back to the bundle", async () => {
    const page = await posts.getPostsPage({ page: 1 });
    assert.equal(page.total, bundledPosts.length);
    assert.equal(page.posts[0].slug, bundledPosts[0].slug);
  });

  test("category list falls back to the bundle", async () => {
    const cat = bundledPosts[0].categories[0].slug;
    const page = await posts.getPostsPage({ page: 1, category: cat });
    assert.ok(page.posts.length > 0);
    assert.ok(page.posts.every((p) => p.categories.some((c) => c.slug === cat)));
  });

  test("a 404 slug falls back to the bundled article", async () => {
    const post = await posts.getPost(bundledPosts[0].slug);
    assert.equal(post?.slug, bundledPosts[0].slug);
    assert.ok(post?.bodyMarkdown.length);
  });

  test("an unknown slug is still null", async () => {
    assert.equal(await posts.getPost("does-not-exist-anywhere"), null);
  });

  test("categories fall back to the bundle (counts match the bundle list)", async () => {
    const cats = await posts.getCategories();
    assert.ok(cats.some((c) => c.postCount > 0));
  });
});

describe("API unavailable", () => {
  beforeEach(() => {
    handler = () => {
      throw new ApiUnavailableError("network");
    };
  });

  test("list and article come from the bundle", async () => {
    assert.equal((await posts.getPostsPage({})).total, bundledPosts.length);
    assert.equal((await posts.getPost(bundledPosts[1].slug))?.slug, bundledPosts[1].slug);
  });

  test("a percent-encoded legacy slug resolves to the canonical bundled post", async () => {
    const withLegacy = bundledPosts.find((p) => p.legacySlugs.some((l) => l !== p.slug));
    assert.ok(withLegacy, "bundle has a legacy slug");
    const legacy = withLegacy.legacySlugs.find((l) => l !== withLegacy.slug)!;
    assert.equal((await posts.getPost(encodeURIComponent(legacy)))?.slug, withLegacy.slug);
  });
});

describe("unknown category while the API has posts elsewhere", () => {
  test("a 404 on the filtered list stays empty", async () => {
    handler = (p, q) => {
      if (p === "/api/v1/posts" && q.category) throw new ApiError(404);
      if (p === "/api/v1/posts") return list([apiPost("live-one")], 1);
      throw new ApiError(404);
    };
    assert.equal((await posts.getPostsPage({ category: "nope" })).posts.length, 0);
  });
});
