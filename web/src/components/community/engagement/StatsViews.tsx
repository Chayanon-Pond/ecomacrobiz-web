/**
 * Engagement counts (views / comments / likes), Wix-card style.
 * Pure markup — no hooks — so the server renders the static shell and the
 * client island (LiveStatsBar) renders the exact same DOM with live numbers.
 * Numbers use tabular figures + a min width, so a live refresh never shifts
 * the layout.
 */
import type { Stats } from "@/lib/community/types";
import { compactNumber, statLabels } from "@/lib/community/format";
import { BubbleIcon, EyeIcon, HeartIcon } from "./icons";

function Count({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  return (
    <span className="inline-flex items-center">
      <span aria-hidden="true" className="inline-flex items-center gap-1.5">
        {icon}
        <span className="min-w-[2.5ch] tabular-nums">{compactNumber(value)}</span>
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/** Inside a card link: plain text only (the whole card is one link). */
export function CardStats({ stats }: { stats: Stats }) {
  return (
    <span className="flex items-center justify-between gap-4 border-t border-line pt-4 text-sm text-subtle">
      <span className="flex items-center gap-4">
        <Count icon={<EyeIcon />} value={stats.views} label={statLabels.views(stats.views)} />
        <Count icon={<BubbleIcon />} value={stats.comments} label={statLabels.comments(stats.comments)} />
      </span>
      <Count icon={<HeartIcon />} value={stats.likes} label={statLabels.likes(stats.likes)} />
    </span>
  );
}

/**
 * Article stats bar. The like button carries `data-engage` so the tiny
 * loader can intercept a click before the island is live and replay it.
 */
export function StatsBarView({
  stats,
  liked = false,
  busy = false,
  live = false,
  onLike,
}: {
  stats: Stats;
  liked?: boolean;
  busy?: boolean;
  live?: boolean;
  onLike?: () => void;
}) {
  return (
    <div
      className="flex min-h-11 flex-wrap items-center gap-x-5 gap-y-2 text-sm text-subtle"
      data-island="stats"
      data-live={live ? "" : undefined}
    >
      <Count icon={<EyeIcon />} value={stats.views} label={statLabels.views(stats.views)} />
      <a
        href="#comments"
        className="inline-flex min-h-11 items-center rounded-full transition-colors hover:text-fg"
      >
        <Count icon={<BubbleIcon />} value={stats.comments} label={statLabels.comments(stats.comments)} />
      </a>
      <button
        type="button"
        data-engage="like-post"
        aria-pressed={liked}
        aria-busy={busy || undefined}
        onClick={onLike}
        className={`group inline-flex min-h-11 items-center gap-2 rounded-full border px-4 transition-[color,background-color,border-color,scale] duration-300 ease-out-expo active:scale-95 ${
          liked
            ? "border-rose-400/50 bg-rose-500/10 text-rose-300"
            : "border-line-strong text-muted hover:border-rose-300/60 hover:text-fg"
        }`}
      >
        <HeartIcon filled={liked} className={`size-[1.15rem] ${liked ? "cm-pop" : ""}`} />
        <span>{liked ? "ถูกใจแล้ว" : "ถูกใจ"}</span>
        <span aria-hidden="true" className="min-w-[2.5ch] tabular-nums">
          {compactNumber(stats.likes)}
        </span>
        <span className="sr-only">({statLabels.likes(stats.likes)})</span>
      </button>
    </div>
  );
}
