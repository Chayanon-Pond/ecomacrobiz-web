import { CalendarClock } from "lucide-react";
import { formatDateTime } from "@/lib/admin/format";
import type { PostStatus } from "@/lib/admin/types";
import { Badge, type BadgeTone } from "../ui";

export const POST_STATUS_TEXT: Record<PostStatus, string> = {
  draft: "ฉบับร่าง",
  published: "เผยแพร่แล้ว",
  scheduled: "ตั้งเวลาไว้",
};

const TONE: Record<PostStatus, BadgeTone> = { draft: "neutral", published: "success", scheduled: "warning" };

/** Status pill; scheduled posts also show when they go live (Bangkok time). */
export function PostStatusBadge({ status, publishedAt }: { status: PostStatus; publishedAt?: string | null }) {
  if (status === "scheduled") {
    return (
      <Badge tone={TONE.scheduled} icon={<CalendarClock size={12} aria-hidden="true" />}>
        {publishedAt ? `ตั้งเวลา ${formatDateTime(publishedAt)}` : POST_STATUS_TEXT.scheduled}
      </Badge>
    );
  }
  return (
    <Badge tone={TONE[status] ?? "neutral"} dot>
      {POST_STATUS_TEXT[status] ?? status}
    </Badge>
  );
}
