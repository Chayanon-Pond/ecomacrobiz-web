import { cx } from "./cx";

/** Inline spinner. With `label` it renders a role=status row; without, decorative. */
export function Spinner({ label, className }: { label?: string; className?: string }) {
  if (!label) return <span className={cx("adm-spinner inline-block", className)} aria-hidden="true" />;
  return (
    <span className={cx("inline-flex items-center gap-3 text-muted", className)} role="status">
      <span className="adm-spinner" aria-hidden="true" />
      <span className="text-sm">{label}</span>
    </span>
  );
}
