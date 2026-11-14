import { COMMENT_STATUS_LABEL, MEMBER_ROLE_LABEL } from "@/lib/admin/community";
import type { CommentStatus, MemberRole } from "@/lib/admin/types";
import { avatarColor, initials } from "@/lib/community/avatar";
import { Badge, type BadgeTone } from "../ui/Badge";

const STATUS_TONE: Record<CommentStatus, BadgeTone> = {
  pending: "warning",
  published: "success",
  hidden: "neutral",
  deleted: "danger",
};

export function CommentStatusBadge({ status }: { status: CommentStatus }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? "neutral"} dot>
      {COMMENT_STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const ROLE_TONE: Record<MemberRole, BadgeTone> = {
  member: "neutral",
  trusted: "success",
  moderator: "violet",
  banned: "danger",
};

export function MemberRoleBadge({ role, title }: { role: MemberRole; title?: string }) {
  return (
    <Badge tone={ROLE_TONE[role] ?? "neutral"} title={title}>
      {MEMBER_ROLE_LABEL[role] ?? role}
    </Badge>
  );
}

/** Same initials + colour as the public comments (decorative; the name is shown next to it). */
export function MemberAvatar({
  id,
  name,
  url,
  size = "md",
}: {
  id: string;
  name: string;
  url?: string | null;
  size?: "sm" | "md";
}) {
  return (
    <span className="cm-avatar" data-size={size === "sm" ? "sm" : undefined} style={{ background: avatarColor(id) }} aria-hidden="true">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" loading="lazy" decoding="async" />
      ) : (
        initials(name)
      )}
    </span>
  );
}

/** Shown in place of the author when the member deleted their account. */
export const DELETED_AUTHOR = "ผู้ใช้ที่ลบบัญชี";
