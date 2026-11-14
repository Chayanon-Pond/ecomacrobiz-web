/**
 * Live post stats + the post like action, shared by the stats bar and the
 * comments island (a new published comment bumps the count; a pending action
 * replayed after sign-in can like the post). Tiny external store for
 * useSyncExternalStore.
 */
import { CommunityError, communityJson } from "@/lib/community/client";
import { getSnapshot as getSession, loadSession } from "@/lib/community/session";
import type { LikeState, PostStats, Stats } from "@/lib/community/types";
import { openAuth } from "@/components/community/auth/open-auth";
import { actionErrorMessage } from "../comments/messages";

export type StatsState = { stats: Stats; liked: boolean; busy: boolean; error: string | null };

const states = new Map<string, StatsState>();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function set(slug: string, patch: Partial<StatsState>) {
  const cur = states.get(slug) ?? { stats: { views: 0, likes: 0, comments: 0 }, liked: false, busy: false, error: null };
  states.set(slug, { ...cur, ...patch });
  emit();
}

export function subscribeStats(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function getStatsState(slug: string): StatsState | undefined {
  return states.get(slug);
}

export function seedStats(slug: string, s: PostStats) {
  set(slug, { stats: { views: s.views, likes: s.likes, comments: s.comments }, liked: s.liked_by_me, error: null });
}

export function bumpCommentCount(slug: string, delta: number) {
  const cur = states.get(slug);
  if (!cur) return;
  set(slug, { stats: { ...cur.stats, comments: Math.max(0, cur.stats.comments + delta) } });
}

export function setCommentCount(slug: string, n: number) {
  const cur = states.get(slug);
  if (cur && cur.stats.comments !== n) set(slug, { stats: { ...cur.stats, comments: n } });
}

/**
 * Toggles (or, with `want`, sets) the post like. Logged out → sign-in modal
 * first, then completes the like. Optimistic with rollback.
 */
export async function likePost(slug: string, want?: boolean, returnFocus?: HTMLElement | null): Promise<void> {
  const cur = states.get(slug);
  if (!cur || cur.busy) return;
  let session = getSession();
  if (session.status === "unknown") session = await loadSession();
  if (session.status !== "member") {
    const me = await openAuth({ reason: "like", pending: { kind: "like-post", slug }, returnFocus });
    if (!me) return;
    want = true;
  }
  const liked = want ?? !cur.liked;
  if (liked === cur.liked && want !== undefined) return;
  const prev = { stats: cur.stats, liked: cur.liked };
  set(slug, {
    busy: true,
    error: null,
    liked,
    stats: { ...cur.stats, likes: Math.max(0, cur.stats.likes + (liked ? 1 : -1)) },
  });
  try {
    const res = await communityJson<LikeState>(`posts/${encodeURIComponent(slug)}/like`, {
      method: liked ? "PUT" : "DELETE",
    });
    const now = states.get(slug)!;
    set(slug, { busy: false, liked: res.liked, stats: { ...now.stats, likes: res.likes } });
  } catch (err) {
    if (err instanceof CommunityError && err.status === 401) void loadSession(true);
    set(slug, { busy: false, ...prev, error: actionErrorMessage(err) });
  }
}
