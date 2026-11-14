/** Labels and pure helpers for the comment moderation and member pages. */
import type { AdminComment, BulkResult, CommentBulkAction, CommentCounts, CommentFilter, CommentStatus, MemberRole } from "./types";

export const COMMENT_FILTERS: { value: CommentFilter; label: string }[] = [
  { value: "pending", label: "รอตรวจ" },
  { value: "reported", label: "รายงาน" },
  { value: "published", label: "เผยแพร่" },
  { value: "hidden", label: "ซ่อน" },
  { value: "deleted", label: "ลบแล้ว" },
  { value: "all", label: "ทั้งหมด" },
];

export const COMMENT_STATUS_LABEL: Record<CommentStatus, string> = {
  pending: "รอตรวจ",
  published: "เผยแพร่",
  hidden: "ซ่อน",
  deleted: "ลบแล้ว",
};

export const REPORT_REASON_LABEL: Record<string, string> = {
  spam: "สแปม / โฆษณา",
  harassment: "คุกคามหรือก่อกวน",
  inappropriate: "เนื้อหาไม่เหมาะสม",
  other: "อื่น ๆ",
};

export function reportReasonLabel(reason: string): string {
  return REPORT_REASON_LABEL[reason] ?? reason;
}

export const MEMBER_ROLE_LABEL: Record<MemberRole, string> = {
  member: "สมาชิก",
  trusted: "สมาชิกที่เชื่อถือได้",
  moderator: "ผู้ดูแลความคิดเห็น",
  banned: "ถูกระงับ",
};

/** Longer labels for pickers (role dialog, role filter). */
export const MEMBER_ROLE_OPTION_LABEL: Record<MemberRole, string> = {
  ...MEMBER_ROLE_LABEL,
  trusted: "สมาชิกที่เชื่อถือได้ (ไม่ต้องรอตรวจ)",
};

export const MEMBER_ROLE_DESCRIPTION: Record<Exclude<MemberRole, "banned">, string> = {
  member: "ความคิดเห็นแรกอาจต้องรอตรวจก่อนแสดง",
  trusted: "ความคิดเห็นแสดงบนเว็บไซต์ทันที",
  moderator: "ไม่ต้องรอตรวจ และอนุมัติ/ซ่อนความคิดเห็นจากหน้าบทความได้",
};

/** Roles an admin can assign directly (ban has its own dialog). */
export const ASSIGNABLE_MEMBER_ROLES: Exclude<MemberRole, "banned">[] = ["member", "trusted", "moderator"];

export const MEMBER_ROLE_FILTERS: { value: MemberRole | ""; label: string }[] = [
  { value: "", label: "ทุกบทบาท" },
  { value: "member", label: MEMBER_ROLE_LABEL.member },
  { value: "trusted", label: "สมาชิกที่เชื่อถือได้ (ไม่ต้องรอตรวจ)" },
  { value: "moderator", label: MEMBER_ROLE_LABEL.moderator },
  { value: "banned", label: MEMBER_ROLE_LABEL.banned },
];

export function isCommentFilter(v: string | null | undefined): v is CommentFilter {
  return COMMENT_FILTERS.some((f) => f.value === v);
}

/**
 * Tab shown when the URL has no explicit status: the moderation queue while
 * something waits there, otherwise everything.
 */
export function defaultCommentFilter(counts: CommentCounts | null): CommentFilter {
  return counts && counts.pending === 0 ? "all" : "pending";
}

/** The API matches e-mails exactly (blind index) when the query contains "@". */
export function isEmailQuery(q: string): boolean {
  return q.includes("@");
}

/** Which single-row actions make sense for a status. */
export function commentActions(status: CommentStatus): { approve: boolean; hide: boolean; remove: boolean } {
  return {
    approve: status === "pending" || status === "hidden",
    hide: status === "pending" || status === "published",
    remove: status !== "deleted",
  };
}

const BULK_DONE: Record<CommentBulkAction, string> = {
  approve: "อนุมัติ",
  hide: "ซ่อน",
  delete: "ลบ",
};

/** Toast text for a bulk run: "อนุมัติ 3 ความคิดเห็น" / "... · ไม่สำเร็จ 1". */
export function bulkSummary(action: CommentBulkAction, r: BulkResult): string {
  const ok = `${BULK_DONE[action]}แล้ว ${r.succeeded.length.toLocaleString("th-TH")} ความคิดเห็น`;
  return r.failed.length ? `${ok} · ไม่สำเร็จ ${r.failed.length.toLocaleString("th-TH")}` : ok;
}

/** Plain one-line excerpt of a comment for dialogs and labels. */
export function commentExcerpt(c: Pick<AdminComment, "body" | "image">, max = 80): string {
  const text = c.body.replace(/\s+/g, " ").trim();
  if (!text) return c.image ? "(รูปภาพ)" : "(ไม่มีข้อความ)";
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : text;
}
