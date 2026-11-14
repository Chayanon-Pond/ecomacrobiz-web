import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cx } from "./cx";
import { Skeleton } from "./Skeleton";

/** Percentage change vs a previous period; null when the base is 0. */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function Delta({
  current,
  previous,
  label = "เทียบช่วงก่อนหน้า",
  invert,
}: {
  current: number;
  previous: number;
  label?: string;
  /** true when "down" is good (e.g. spam). */
  invert?: boolean;
}) {
  const diff = current - previous;
  const pct = pctChange(current, previous);
  const dir = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const good = invert ? (dir === "up" ? "down" : dir === "down" ? "up" : "flat") : dir;
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : ArrowRight;
  const text =
    pct === null
      ? diff === 0
        ? "เท่าเดิม"
        : `${diff > 0 ? "+" : ""}${diff.toLocaleString("th-TH")}`
      : `${pct > 0 ? "+" : ""}${pct.toFixed(Math.abs(pct) < 10 ? 1 : 0)}%`;
  const sr =
    dir === "flat"
      ? `เท่ากับ${label} (${previous.toLocaleString("th-TH")})`
      : `${dir === "up" ? "เพิ่มขึ้น" : "ลดลง"} ${text} ${label} (${previous.toLocaleString("th-TH")})`;
  return (
    <span className="adm-stat-foot">
      <span className="adm-delta" data-dir={good}>
        <Icon size={14} aria-hidden="true" />
        <span aria-hidden="true">{text}</span>
      </span>
      <span aria-hidden="true">{label}</span>
      <span className="adm-sr-only">{sr}</span>
    </span>
  );
}

/** KPI tile. `value` undefined + loading -> skeleton. */
export function StatCard({
  label,
  value,
  icon,
  foot,
  href,
  loading,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  foot?: ReactNode;
  href?: string;
  loading?: boolean;
  className?: string;
}) {
  const inner = (
    <div className="adm-stat">
      <span className="adm-stat-label">
        {icon}
        {label}
      </span>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <span className="adm-stat-value">{typeof value === "number" ? value.toLocaleString("th-TH") : value}</span>
      )}
      {loading ? <Skeleton className="h-3.5 w-28" /> : foot}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className={cx("adm-card adm-card-link", className)}>
        {inner}
      </Link>
    );
  }
  return <div className={cx("adm-card", className)}>{inner}</div>;
}
