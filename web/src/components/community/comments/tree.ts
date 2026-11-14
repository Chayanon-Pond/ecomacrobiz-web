/**
 * Immutable operations on the comment list (top-level comments with their
 * loaded replies). Pure and unit-tested; the island's reducer is built on it.
 */
import type { Comment } from "@/lib/community/types";

export function findComment(list: Comment[], id: string): Comment | null {
  for (const c of list) {
    if (c.id === id) return c;
    for (const r of c.replies ?? []) if (r.id === id) return r;
  }
  return null;
}

/** Applies `fn` to the comment with `id` wherever it is (top level or reply). */
export function updateComment(list: Comment[], id: string, fn: (c: Comment) => Comment): Comment[] {
  let changed = false;
  const next = list.map((c) => {
    if (c.id === id) {
      changed = true;
      return fn(c);
    }
    if (!c.replies?.some((r) => r.id === id)) return c;
    changed = true;
    return { ...c, replies: c.replies.map((r) => (r.id === id ? fn(r) : r)) };
  });
  return changed ? next : list;
}

export function replaceComment(list: Comment[], id: string, replacement: Comment): Comment[] {
  return updateComment(list, id, (old) =>
    // A replacement for a top-level comment keeps the replies already loaded.
    old.parent_id === null && replacement.parent_id === null && (replacement.replies?.length ?? 0) === 0
      ? { ...replacement, replies: old.replies, reply_count: Math.max(replacement.reply_count, old.reply_count) }
      : replacement,
  );
}

export function prependTopLevel(list: Comment[], c: Comment): Comment[] {
  return [c, ...list.filter((x) => x.id !== c.id)];
}

/** Appends a reply to its thread (oldest first) and bumps reply_count. */
export function appendReply(list: Comment[], parentId: string, reply: Comment): Comment[] {
  return list.map((c) =>
    c.id === parentId
      ? {
          ...c,
          replies: [...(c.replies ?? []).filter((r) => r.id !== reply.id), reply],
          reply_count: c.reply_count + 1,
        }
      : c,
  );
}

/**
 * Removes a comment as the server's soft delete shows it to others: a
 * top-level comment that still has replies becomes a "deleted" placeholder,
 * everything else disappears (and the parent's reply_count drops).
 */
export function removeComment(list: Comment[], id: string): Comment[] {
  const out: Comment[] = [];
  for (const c of list) {
    if (c.id === id) {
      if ((c.replies?.length ?? 0) > 0 || c.reply_count > 0) {
        out.push({
          ...c,
          status: "deleted",
          body: "",
          body_html: "",
          image: null,
          like_count: 0,
          liked_by_me: false,
          can_edit: false,
          can_delete: false,
          can_report: false,
          can_moderate: false,
        });
      }
      continue;
    }
    if (c.replies?.some((r) => r.id === id)) {
      out.push({
        ...c,
        replies: c.replies.filter((r) => r.id !== id),
        reply_count: Math.max(0, c.reply_count - 1),
      });
      continue;
    }
    out.push(c);
  }
  // A deleted placeholder whose last reply went away disappears too.
  return out.filter((c) => !(c.status === "deleted" && (c.replies?.length ?? 0) === 0 && c.reply_count === 0));
}

/** Drops an optimistic comment that failed (no placeholder logic). */
export function dropComment(list: Comment[], id: string): Comment[] {
  return list
    .filter((c) => c.id !== id)
    .map((c) =>
      c.replies?.some((r) => r.id === id)
        ? { ...c, replies: c.replies.filter((r) => r.id !== id), reply_count: Math.max(0, c.reply_count - 1) }
        : c,
    );
}

export function setLike(list: Comment[], id: string, liked: boolean, likes: number): Comment[] {
  return updateComment(list, id, (c) => ({ ...c, liked_by_me: liked, like_count: Math.max(0, likes) }));
}

/** Next page of top-level comments: append, skipping ids already shown (new posts shift pages). */
export function appendPage(list: Comment[], more: Comment[]): Comment[] {
  const seen = new Set(list.map((c) => c.id));
  return [...list, ...more.filter((c) => !seen.has(c.id))];
}

/** Merges a page of loaded replies into a thread (oldest first, deduped). */
export function mergeReplies(list: Comment[], parentId: string, replies: Comment[], replaceAll: boolean): Comment[] {
  return list.map((c) => {
    if (c.id !== parentId) return c;
    const base = replaceAll ? [] : (c.replies ?? []);
    const seen = new Set(base.map((r) => r.id));
    const merged = [...base, ...replies.filter((r) => !seen.has(r.id))];
    // Keep optimistic/own replies that the server page did not include yet.
    const extra = replaceAll ? (c.replies ?? []).filter((r) => !merged.some((m) => m.id === r.id) && r.id.startsWith("tmp-")) : [];
    return { ...c, replies: [...merged, ...extra] };
  });
}

/** Replies not shown yet in a thread. */
export function hiddenReplyCount(c: Comment): number {
  return Math.max(0, c.reply_count - (c.replies?.length ?? 0));
}
