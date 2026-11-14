/**
 * Reply target + mention-chip token logic (pure, unit-tested).
 *
 * Facebook-style: "ตอบกลับ" opens a composer under the thread prefilled with
 * ONE removable chip naming the replied-to author. The chip is not part of
 * the body: it is sent as `reply_to_id` (the server renders it from
 * `reply_to`). Removing the chip (× or Backspace at the very start of the
 * text) sends `reply_to_id: null`. Depth is always 2: replying to a reply
 * targets the same top-level thread.
 */
import type { Comment } from "@/lib/community/types";

export type MentionChip = { id: string; name: string };

export type ReplyTarget = {
  /** Top-level comment the reply is stored under. */
  parentId: string;
  chip: MentionChip | null;
};

export function replyTargetFor(comment: Pick<Comment, "id" | "parent_id" | "author" | "status">, meId: string | null): ReplyTarget {
  const parentId = comment.parent_id ?? comment.id;
  const mentionable =
    comment.status !== "deleted" && comment.author !== null && comment.author.id !== meId;
  return {
    parentId,
    chip: mentionable && comment.author ? { id: comment.id, name: comment.author.display_name } : null,
  };
}

/** Backspace with a collapsed caret at offset 0 deletes the chip as one token. */
export function chipRemovedByKey(
  key: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  hasChip: boolean,
): boolean {
  return hasChip && key === "Backspace" && selectionStart === 0 && selectionEnd === 0;
}

export type CommentPayload = {
  body: string;
  parent_id?: string;
  reply_to_id?: string | null;
  image_id?: string;
  website: string;
  elapsed_ms: number;
};

export function buildCommentPayload(input: {
  body: string;
  target: ReplyTarget | null;
  chip: MentionChip | null;
  imageId: string | null;
  honeypot: string;
  elapsedMs: number;
}): CommentPayload {
  const payload: CommentPayload = {
    body: input.body.trim(),
    website: input.honeypot,
    elapsed_ms: Math.max(0, Math.round(input.elapsedMs)),
  };
  if (input.target) {
    payload.parent_id = input.target.parentId;
    payload.reply_to_id = input.chip ? input.chip.id : null;
  }
  if (input.imageId) payload.image_id = input.imageId;
  return payload;
}

/** Inserts `text` at the caret, returning the new value and caret offset. */
export function insertAtCaret(
  value: string,
  text: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): { value: string; caret: number } {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  const next = value.slice(0, start) + text + value.slice(end);
  return { value: next, caret: start + text.length };
}

/** Character count as the API counts it (runes / code points). */
export function charCount(s: string): number {
  return Array.from(s.trim()).length;
}
