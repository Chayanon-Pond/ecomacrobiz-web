import type { Channel, LeadStatus, PostStatus } from "./types";

export const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** ASCII-only titles -> kebab slug; returns null when the title has non-ASCII text. */
export function slugFromTitle(title: string): string | null {
  if (/[^\x00-\x7F]/.test(title)) return null;
  return title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

const BKK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok is UTC+7, no DST.

/** ISO instant -> "YYYY-MM-DDTHH:mm" in Bangkok time (for datetime-local). */
export function isoToBangkokInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t + BKK_OFFSET_MS).toISOString().slice(0, 16);
}

/** datetime-local value (Bangkok wall time) -> ISO 8601 with +07:00. */
export function bangkokInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  return `${value}:00+07:00`;
}

const dateFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : dateFmt.format(t);
}

export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  draft: "ฉบับร่าง",
  published: "เผยแพร่แล้ว",
};

export const LEAD_STATUSES: LeadStatus[] = ["new", "contacted", "qualified", "closed", "spam"];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "ใหม่ (New)",
  contacted: "ติดต่อแล้ว (Contacted)",
  qualified: "มีโอกาส (Qualified)",
  closed: "ปิดแล้ว (Closed)",
  spam: "สแปม (Spam)",
};

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: "Email",
  line: "LINE",
  phone: "โทรศัพท์",
};

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
