/**
 * One comment, Facebook style: avatar, rounded bubble (name + role badge +
 * body), optional image, then time · ถูกใจ · ตอบกลับ and a "…" menu.
 *
 * Pure markup (no hooks, no client APIs): the server renders the static
 * comments with it (no handlers; controls carry `data-engage` so the tiny
 * loader can replay the first click) and the client island renders the very
 * same DOM with handlers, so swapping the island in never shifts the layout.
 */
import type { ReactNode } from "react";
import type { Comment } from "@/lib/community/types";
import { DELETED_AUTHOR_NAME, DELETED_COMMENT_TEXT } from "@/lib/community/types";
import { fullThaiDateTime, relativeTimeTh } from "@/lib/community/time";
import { compactNumber } from "@/lib/community/format";
import { Avatar } from "./Avatar";
import { MoreIcon, ThumbIcon } from "../engagement/icons";

const ROLE_BADGE: Record<string, string> = { moderator: "ผู้ดูแล", trusted: "ขาประจำ" };

export const actionClass =
  "inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 font-semibold transition-colors hover:text-fg disabled:cursor-not-allowed disabled:opacity-50";

export function commentDomId(id: string): string {
  return `comment-${id}`;
}

/** The static "…" button (server render, or while a menu is closed). */
export function MenuButton({
  commentId,
  label,
  expanded = false,
  onClick,
  buttonRef,
  onKeyDown,
}: {
  commentId: string;
  label: string;
  expanded?: boolean;
  onClick?: () => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      data-engage="menu"
      data-id={commentId}
      aria-haspopup="menu"
      aria-expanded={expanded}
      aria-label={label}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className="grid size-11 shrink-0 place-items-center rounded-full text-subtle transition-colors hover:bg-surface-2 hover:text-fg"
    >
      <MoreIcon />
    </button>
  );
}

export type CommentViewProps = {
  c: Comment;
  /** Epoch ms used for relative times (server: fetch time, client: Date.now()). */
  now: number;
  reply?: boolean;
  /** Fade-in highlight for a just-posted comment. */
  flash?: boolean;
  /** Optimistic comment still being sent. */
  sending?: boolean;
  onLike?: () => void;
  onReply?: () => void;
  likeBusy?: boolean;
  /** Replaces the default static "…" button (client: the real menu). null = no menu. */
  menu?: ReactNode;
  /** Replaces the bubble while editing in place. */
  editor?: ReactNode;
  /** Thread children: replies, "ดูการตอบกลับ", reply composer (top level only). */
  childrenItems?: ReactNode;
  hasChildren?: boolean;
};

export function CommentView({
  c,
  now,
  reply = false,
  flash = false,
  sending = false,
  onLike,
  onReply,
  likeBusy = false,
  menu,
  editor,
  childrenItems,
  hasChildren = false,
}: CommentViewProps) {
  const deleted = c.status === "deleted";
  const name = c.author?.display_name ?? DELETED_AUTHOR_NAME;
  const size = reply ? 32 : 36;
  const badge = c.author ? ROLE_BADGE[c.author.role] : undefined;
  const interactive = c.status === "published" && !sending;
  const menuNode = menu === undefined ? <MenuButton commentId={c.id} label={`ตัวเลือกสำหรับความคิดเห็นของ ${name}`} /> : menu;

  return (
    <li
      id={commentDomId(c.id)}
      className={`cm-thread flex gap-[var(--cm-gap)] ${hasChildren ? "cm-has-children" : ""} ${
        sending ? "opacity-70" : ""
      } ${c.status === "hidden" ? "opacity-60" : ""}`}
      style={reply ? ({ "--cm-av": "32px" } as React.CSSProperties) : undefined}
      aria-busy={sending || undefined}
    >
      {deleted ? (
        <Avatar neutral size={size} />
      ) : (
        <Avatar id={c.author?.id} name={c.author?.display_name} url={c.author?.avatar_url} size={size} neutral={!c.author} />
      )}

      <div className="min-w-0 flex-1">
        {editor ?? (
          <>
            <div className="flex items-start gap-0.5">
              <div
                className={`min-w-0 max-w-full rounded-[1.15rem] bg-surface-2 px-3.5 py-2 ${flash ? "cm-flash" : ""}`}
              >
                {deleted ? (
                  <p className="text-[0.95rem] italic leading-[1.7] text-subtle">{DELETED_COMMENT_TEXT}</p>
                ) : (
                  <>
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-semibold leading-6 text-fg">
                      <span className={c.author ? "" : "text-muted"}>{name}</span>
                      {badge && (
                        <span className="rounded-full bg-accent/20 px-2 text-[0.7rem] font-semibold leading-5 text-accent-soft">
                          {badge}
                        </span>
                      )}
                    </p>
                    {(c.body_html || c.reply_to) && (
                      <div className="cm-body break-words text-[0.95rem] leading-[1.7] text-fg/90">
                        {c.reply_to && (
                          <>
                            <a className="cm-mention" href={`#${commentDomId(c.reply_to.id)}`}>
                              {c.reply_to.display_name}
                            </a>{" "}
                          </>
                        )}
                        <span dangerouslySetInnerHTML={{ __html: c.body_html }} />
                      </div>
                    )}
                  </>
                )}
              </div>
              {!deleted && menuNode}
            </div>

            {!deleted && c.image && (
              <a
                href={c.image.url}
                target="_blank"
                rel="noopener"
                className="mt-1.5 block w-fit max-w-full overflow-hidden rounded-2xl border border-line"
                aria-label={`เปิดรูปภาพของ ${name} ขนาดเต็ม (แท็บใหม่)`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- re-encoded API media with known size */}
                <img
                  src={c.image.url}
                  alt={`รูปภาพประกอบความคิดเห็นของ ${name}`}
                  width={c.image.width}
                  height={c.image.height}
                  loading="lazy"
                  decoding="async"
                  className="block h-auto max-h-80 w-auto max-w-full bg-surface"
                />
              </a>
            )}

            {!deleted && (
              <div className="flex flex-wrap items-center gap-x-0.5 pl-1.5 text-xs text-subtle">
                <time
                  dateTime={c.created_at}
                  title={fullThaiDateTime(c.created_at)}
                  className="inline-flex min-h-11 items-center px-1.5"
                >
                  {sending ? "กำลังส่ง…" : relativeTimeTh(c.created_at, now)}
                </time>
                {c.status === "pending" && (
                  <span className="rounded-full bg-amber-400/15 px-2 py-0.5 font-semibold text-amber-300">
                    รอการอนุมัติ
                  </span>
                )}
                {c.status === "hidden" && (
                  <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-muted">ซ่อนอยู่</span>
                )}
                {interactive && (
                  <button
                    type="button"
                    data-engage="like-comment"
                    data-id={c.id}
                    aria-pressed={c.liked_by_me}
                    aria-label={`ถูกใจความคิดเห็นของ ${name}${c.like_count > 0 ? ` (${c.like_count} คนถูกใจ)` : ""}`}
                    aria-busy={likeBusy || undefined}
                    onClick={onLike}
                    className={`${actionClass} ${c.liked_by_me ? "text-accent-soft" : ""}`}
                  >
                    <ThumbIcon filled={c.liked_by_me} className={`size-4 ${c.liked_by_me ? "cm-pop" : ""}`} />
                    <span>ถูกใจ</span>
                    {c.like_count > 0 && <span className="tabular-nums">{compactNumber(c.like_count)}</span>}
                  </button>
                )}
                {interactive && (
                  <button
                    type="button"
                    data-engage="reply"
                    data-id={c.id}
                    aria-label={`ตอบกลับความคิดเห็นของ ${name}`}
                    onClick={onReply}
                    className={actionClass}
                  >
                    ตอบกลับ
                  </button>
                )}
                {c.edited_at && (
                  <span className="px-1.5" title={`แก้ไขเมื่อ ${fullThaiDateTime(c.edited_at)}`}>
                    แก้ไขแล้ว
                  </span>
                )}
              </div>
            )}
          </>
        )}

        {deleted && <div className="h-2" aria-hidden="true" />}
        {childrenItems && <ul className="cm-children mt-1 flex flex-col gap-1">{childrenItems}</ul>}
      </div>
    </li>
  );
}
