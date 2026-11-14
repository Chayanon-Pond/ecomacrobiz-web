/**
 * Cached, anonymous community reads for server rendering (article comments,
 * engagement counts on cards). Same policy as lib/posts.ts: `'use cache'`
 * readers tagged for the API's revalidation webhook, and they NEVER throw —
 * API_URL unset or the API down yields an empty list / zero counts with
 * `live: false`, so `next build` and the static shell always render.
 *
 *   getComments(slug)  tag comments:<slug>  cacheLife hours   (webhook on every visible change)
 *   getStats(slugs)    tag post-stats       cacheLife minutes (likes/views never send webhooks)
 */
import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { ApiUnavailableError, apiGet } from "@/lib/api/client";
import { ZERO_STATS } from "./format";
import type { Comment, CommentsMeta, Stats } from "./types";

export const COMMENTS_PER_PAGE = 10;
export const REPLIES_PREVIEW = 2;
const MAX_STATS_SLUGS = 50;

export type CommentsResult = {
  /** false = API unset/down: render the empty state, omit JSON-LD counts. */
  live: boolean;
  comments: Comment[];
  meta: CommentsMeta;
  /** Epoch ms of the fetch: relative times are computed against it (cached render). */
  fetchedAt: number;
};

export type StatsResult = {
  live: boolean;
  /** Every requested slug is present (zeros when unknown or unavailable). */
  bySlug: Record<string, Stats>;
};

function isUnconfigured(err: unknown): boolean {
  return err instanceof ApiUnavailableError && err.reason === "unconfigured";
}

/** See lib/posts.ts fallbackCacheLife: retry within minutes unless the API is simply not configured. */
function fallbackCacheLife(err: unknown) {
  if (isUnconfigured(err) && process.env.NEXT_PHASE !== "phase-production-build") cacheLife("max");
  else cacheLife({ stale: 60, revalidate: 300, expire: 3600 });
}

function warn(fn: string, err: unknown) {
  if (isUnconfigured(err)) return;
  const why = err instanceof Error ? err.message : String(err);
  console.warn(`[community] ${fn}: API failed, rendering without community data (${why})`);
}

const emptyMeta: CommentsMeta = { page: 1, per_page: COMMENTS_PER_PAGE, total: 0, total_pages: 0, comment_count: 0 };

/** First page (newest) of published comments + 2 reply previews each, as an anonymous visitor. */
export async function getComments(slug: string): Promise<CommentsResult> {
  "use cache";
  cacheTag(`comments:${slug}`);
  const fetchedAt = Date.now();
  try {
    const res = await apiGet<{ data: Comment[]; meta: CommentsMeta }>(
      `/api/v1/community/posts/${encodeURIComponent(slug)}/comments`,
      { query: { sort: "newest", page: 1, per_page: COMMENTS_PER_PAGE, replies_preview: REPLIES_PREVIEW } },
    );
    cacheLife("hours");
    return { live: true, comments: res.data ?? [], meta: res.meta ?? emptyMeta, fetchedAt };
  } catch (err) {
    warn("getComments", err);
    fallbackCacheLife(err);
    return { live: false, comments: [], meta: emptyMeta, fetchedAt };
  }
}

/** Normalizes a slug list into a stable cache key (sorted, unique, ≤ 50). */
export function statsKey(slugs: string[]): string[] {
  return Array.from(new Set(slugs.map((s) => s.normalize("NFC")).filter(Boolean)))
    .sort()
    .slice(0, MAX_STATS_SLUGS);
}

async function fetchStats(key: string[]): Promise<StatsResult> {
  "use cache";
  cacheTag("post-stats");
  const bySlug: Record<string, Stats> = Object.fromEntries(key.map((s) => [s, { ...ZERO_STATS }]));
  if (key.length === 0) {
    cacheLife("max");
    return { live: true, bySlug };
  }
  try {
    const res = await apiGet<{ data: Record<string, Partial<Stats>> }>("/api/v1/community/stats", {
      query: { slugs: key.join(",") },
    });
    cacheLife("minutes");
    for (const [slug, s] of Object.entries(res.data ?? {})) {
      if (!(slug in bySlug)) continue;
      bySlug[slug] = { views: s.views ?? 0, likes: s.likes ?? 0, comments: s.comments ?? 0 };
    }
    return { live: true, bySlug };
  } catch (err) {
    warn("getStats", err);
    fallbackCacheLife(err);
    return { live: false, bySlug };
  }
}

/** Views / likes / comments for up to 50 posts in one request. */
export function getStats(slugs: string[]): Promise<StatsResult> {
  return fetchStats(statsKey(slugs));
}
