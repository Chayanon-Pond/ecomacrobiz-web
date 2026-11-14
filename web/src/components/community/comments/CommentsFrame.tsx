/**
 * Layout of the comments section (heading + sort, composer area, list, "more").
 * Pure markup shared by the server render and the client island.
 */
import type { ReactNode } from "react";
import type { CommentSort } from "@/lib/community/types";
import { fullNumber } from "@/lib/community/format";
import { Avatar } from "./Avatar";
import { CameraIcon, SendIcon, SmileIcon } from "../engagement/icons";

export const COMMENTS_SECTION_ID = "comments";

const sortBtn =
  "inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors aria-pressed:bg-surface-2 aria-pressed:text-fg text-subtle hover:text-fg";

export const moreButtonClass =
  "inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-muted transition-colors hover:text-fg disabled:opacity-60";

export function CommentsFrame({
  count,
  sort,
  onSort,
  sortDisabled = false,
  top,
  items,
  empty,
  more,
  status,
  live = false,
}: {
  count: number;
  sort: CommentSort;
  onSort?: (s: CommentSort) => void;
  sortDisabled?: boolean;
  /** Session line, banners, composer or the sign-in prompt. */
  top: ReactNode;
  items: ReactNode;
  empty: boolean;
  more?: ReactNode;
  /** Polite live region text (posting, errors, loaded). */
  status?: string;
  live?: boolean;
}) {
  return (
    <section
      id={COMMENTS_SECTION_ID}
      aria-labelledby="comments-title"
      className="cm-section scroll-mt-[calc(var(--header-h)+1.5rem)]"
      data-island="comments"
      data-live={live ? "" : undefined}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <h2 id="comments-title" tabIndex={-1} className="thai-heading text-[clamp(1.35rem,2.4vw,1.75rem)] font-semibold">
          ความคิดเห็น{" "}
          <span className="tabular-nums text-subtle">
            ({fullNumber(count)})
          </span>
        </h2>
        <div role="group" aria-label="เรียงลำดับความคิดเห็น" className="inline-flex rounded-full border border-line p-0.5">
          {(
            [
              ["newest", "ล่าสุด"],
              ["top", "ยอดนิยม"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              data-engage="sort"
              data-value={value}
              aria-pressed={sort === value}
              disabled={sortDisabled}
              onClick={onSort ? () => onSort(value) : undefined}
              className={sortBtn}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">{top}</div>

      {empty ? (
        <p className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line px-6 py-8 text-center text-muted">
          ยังไม่มีความคิดเห็น — เริ่มแบ่งปันมุมมองของคุณเป็นคนแรก
        </p>
      ) : (
        <ol aria-label="รายการความคิดเห็น" className="mt-8 flex flex-col gap-3">
          {items}
        </ol>
      )}

      {more && <div className="mt-4 pl-[calc(var(--cm-av)+var(--cm-gap))]">{more}</div>}

      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
    </section>
  );
}

/** Shared composer shell classes so the sign-in prompt has the composer's exact size. */
export const composerShell =
  "min-w-0 flex-1 rounded-[1.4rem] bg-surface-2 ring-1 ring-line transition-shadow focus-within:ring-accent-soft/60";
export const composerFirstRow = "flex min-h-[2.75rem] flex-wrap items-center gap-x-1.5 gap-y-1 px-4 pt-2.5";
export const composerToolbar = "flex min-h-11 items-center justify-between gap-2 pb-1 pl-4 pr-1.5";

/** Logged-out (or not-yet-live) composer: one button that opens sign-in. */
export function SignInComposer({ onClick }: { onClick?: () => void }) {
  return (
    <div className="flex gap-[var(--cm-gap)]">
      <Avatar neutral size={36} />
      <button
        type="button"
        data-engage="compose"
        onClick={onClick}
        className={`${composerShell} block text-left hover:ring-line-strong`}
      >
        <span className={composerFirstRow}>
          <span className="py-1 text-[0.95rem] text-muted">เขียนความคิดเห็น…</span>
        </span>
        <span className={composerToolbar} aria-hidden="true">
          <span className="text-xs text-subtle">เข้าสู่ระบบเพื่อร่วมแสดงความคิดเห็น</span>
          <span className="flex items-center text-subtle">
            <span className="grid size-11 place-items-center">
              <SmileIcon />
            </span>
            <span className="grid size-11 place-items-center">
              <CameraIcon />
            </span>
            <span className="grid size-11 place-items-center">
              <SendIcon />
            </span>
          </span>
        </span>
      </button>
    </div>
  );
}

export function GuidelinesNote() {
  return (
    <p className="mt-2 pl-[calc(var(--cm-av)+var(--cm-gap))] text-xs leading-6 text-subtle">
      โปรดแสดงความคิดเห็นอย่างสุภาพตาม{" "}
      <a href="/community-guidelines" className="text-accent-soft underline underline-offset-4">
        แนวทางชุมชน
      </a>
    </p>
  );
}
