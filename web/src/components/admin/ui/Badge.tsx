import type { ReactNode } from "react";
import { ROLE_LABEL, type Role } from "@/lib/admin/permissions";
import type { LeadStatus } from "@/lib/admin/types";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger" | "violet";

export function Badge({
  tone = "neutral",
  dot,
  icon,
  className,
  children,
  title,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span className={cx("adm-badge", className)} data-tone={tone} title={title}>
      {dot ? <span className="adm-badge-dot" aria-hidden="true" /> : icon}
      {children}
    </span>
  );
}

export const ROLE_TONE: Record<Role, BadgeTone> = {
  owner: "violet",
  editor: "info",
  sales: "success",
  viewer: "neutral",
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <Badge tone={ROLE_TONE[role] ?? "neutral"} className={className}>
      {ROLE_LABEL[role] ?? role}
    </Badge>
  );
}

export const LEAD_STATUS_TONE: Record<LeadStatus, BadgeTone> = {
  new: "info",
  contacted: "warning",
  qualified: "success",
  closed: "neutral",
  spam: "danger",
};

/** Short Thai labels for chips/columns (format.ts LEAD_STATUS_LABEL has the long "ไทย (English)" form). */
export const LEAD_STATUS_SHORT: Record<LeadStatus, string> = {
  new: "ใหม่",
  contacted: "ติดต่อแล้ว",
  qualified: "มีโอกาส",
  closed: "ปิดแล้ว",
  spam: "สแปม",
};

export function LeadStatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  return (
    <Badge tone={LEAD_STATUS_TONE[status] ?? "neutral"} dot className={className}>
      {LEAD_STATUS_SHORT[status] ?? status}
    </Badge>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <Badge tone="success" dot>
      ใช้งานอยู่
    </Badge>
  ) : (
    <Badge tone="danger" dot>
      ระงับแล้ว
    </Badge>
  );
}
