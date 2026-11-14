import { cx } from "./cx";

export function Skeleton({ className }: { className?: string }) {
  return <span className={cx("adm-skel", className ?? "h-4 w-full")} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx("grid gap-2", className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="adm-skel h-3.5" style={{ width: i === lines - 1 ? "60%" : "100%" }} />
      ))}
    </span>
  );
}

/** Table placeholder with a screen-reader status. */
export function TableSkeleton({ rows = 6, cols = 5, label = "กำลังโหลดข้อมูล…" }: { rows?: number; cols?: number; label?: string }) {
  return (
    <div className="adm-table-wrap" role="status" aria-live="polite">
      <span className="adm-sr-only">{label}</span>
      <div className="grid gap-0" aria-hidden="true">
        <div className="flex gap-4 border-b border-line bg-surface-2 px-4 py-3">
          {Array.from({ length: cols }, (_, c) => (
            <span key={c} className="adm-skel h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
            {Array.from({ length: cols }, (_, c) => (
              <span key={c} className="adm-skel h-3.5 flex-1" style={{ opacity: 1 - r * 0.08 }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
