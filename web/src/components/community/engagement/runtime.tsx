"use client";

/**
 * Engagement runtime — the lazily imported chunk (never in the initial
 * bundle). boot(slug) loads the member session, the community config, the
 * live post stats (liked_by_me) and the first comments page with the cookie
 * (own pending comments, can_edit / can_moderate) in parallel; the islands
 * swap in only after it resolves, so the static markup stays until the live
 * data is ready.
 */
import { communityEnvelope, communityJson } from "@/lib/community/client";
import { loadSession, type SessionState } from "@/lib/community/session";
import type { CommentsPage, CommunityConfig, PostStats } from "@/lib/community/types";
import { COMMENT_MAX_CHARS } from "@/lib/community/types";
import { seedStats } from "./stats-store";

export { LiveStatsBar } from "./LiveStatsBar";
export { CommentsApp } from "../comments/CommentsApp";

export const COMMENTS_PER_PAGE = 10;
export const REPLIES_PREVIEW = 2;

export type BootData = {
  slug: string;
  session: SessionState;
  config: CommunityConfig;
  comments: CommentsPage;
  /** Time the data was fetched (client clock). */
  at: number;
};

const DEFAULT_CONFIG: CommunityConfig = {
  google_enabled: false,
  require_verified_email: false,
  email_transport: false,
  consent_version: "",
  comment_max_chars: COMMENT_MAX_CHARS,
  comment_image_max_mb: 5,
  avatar_max_mb: 5,
  turnstile: false,
};

let configPromise: Promise<CommunityConfig> | null = null;

export function getConfig(): Promise<CommunityConfig> {
  configPromise ??= communityJson<CommunityConfig>("config").catch(() => {
    configPromise = null;
    return DEFAULT_CONFIG;
  });
  return configPromise;
}

export function fetchComments(slug: string, sort: "newest" | "top", page: number): Promise<CommentsPage> {
  return communityEnvelope<CommentsPage>(`posts/${encodeURIComponent(slug)}/comments`, {
    query: { sort, page, per_page: COMMENTS_PER_PAGE, replies_preview: REPLIES_PREVIEW },
  });
}

const boots = new Map<string, Promise<BootData>>();
const booted = new Map<string, BootData>();

/** Deduped per slug; rejects on network/API failure (the island then keeps the static markup). */
export function boot(slug: string): Promise<BootData> {
  let p = boots.get(slug);
  if (!p) {
    p = (async () => {
      const [session, config, stats, comments] = await Promise.all([
        loadSession(),
        getConfig(),
        communityJson<PostStats>(`posts/${encodeURIComponent(slug)}/stats`),
        fetchComments(slug, "newest", 1),
      ]);
      seedStats(slug, stats);
      const data: BootData = { slug, session, config, comments, at: Date.now() };
      booted.set(slug, data);
      return data;
    })();
    p.catch(() => boots.delete(slug));
    boots.set(slug, p);
  }
  return p;
}

/** Synchronous access for components that mount after boot resolved. */
export function bootData(slug: string): BootData | null {
  return booted.get(slug) ?? null;
}
