/**
 * Server-rendered comments (first page, newest, 2 reply previews each) for
 * SEO and no-JS visitors. Same components as the client island; buttons are
 * inert here and carry `data-engage` for the tiny loader to replay.
 */
import type { Comment } from "@/lib/community/types";
import { fullNumber } from "@/lib/community/format";
import type { CommentsResult } from "@/lib/community/server";
import { CommentView } from "./CommentView";
import { CommentsFrame, GuidelinesNote, SignInComposer, moreButtonClass } from "./CommentsFrame";
import { hiddenReplyCount } from "./tree";

export function RepliesToggle({
  parentId,
  count,
  expanded = false,
  busy = false,
  onClick,
}: {
  parentId: string;
  count: number;
  expanded?: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        data-engage="replies"
        data-id={parentId}
        aria-expanded={expanded}
        aria-busy={busy || undefined}
        disabled={busy}
        onClick={onClick}
        className={moreButtonClass}
      >
        {expanded ? "ซ่อนการตอบกลับ" : busy ? "กำลังโหลด…" : `ดูการตอบกลับ ${fullNumber(count)} รายการ`}
      </button>
    </li>
  );
}

function StaticThread({ c, now }: { c: Comment; now: number }) {
  const replies = c.replies ?? [];
  const hidden = hiddenReplyCount(c);
  const hasChildren = replies.length > 0 || hidden > 0;
  return (
    <CommentView
      c={c}
      now={now}
      hasChildren={hasChildren}
      childrenItems={
        hasChildren ? (
          <>
            {replies.map((r) => (
              <CommentView key={r.id} c={r} now={now} reply />
            ))}
            {hidden > 0 && <RepliesToggle parentId={c.id} count={hidden} />}
          </>
        ) : null
      }
    />
  );
}

export function CommentsStatic({ data, count }: { data: CommentsResult; count: number }) {
  const { comments, meta, fetchedAt } = data;
  return (
    <CommentsFrame
      count={count}
      sort="newest"
      top={
        <>
          <SignInComposer />
          <GuidelinesNote />
        </>
      }
      empty={comments.length === 0}
      items={comments.map((c) => (
        <StaticThread key={c.id} c={c} now={fetchedAt} />
      ))}
      more={
        meta.total_pages > 1 ? (
          <button type="button" data-engage="more" className={moreButtonClass}>
            ดูความคิดเห็นเพิ่มเติม
          </button>
        ) : undefined
      }
    />
  );
}
