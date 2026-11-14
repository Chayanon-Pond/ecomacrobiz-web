import type { Lead, UserRef } from "@/lib/admin/types";

export function leadName(l: Pick<Lead, "first_name" | "last_name">) {
  return [l.first_name, l.last_name].filter(Boolean).join(" ") || "—";
}

export function preferredSlot(l: Pick<Lead, "preferred_date" | "preferred_time">) {
  if (!l.preferred_date && !l.preferred_time) return "—";
  let d = l.preferred_date ?? "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) {
    d = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    );
  }
  return [d, l.preferred_time].filter(Boolean).join(" ");
}

/** tel: href with only digits and a leading +, or null. */
export function telHref(phone: string): string | null {
  const p = phone.trim().replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return p.replace(/\D/g, "").length >= 6 ? `tel:${p}` : null;
}

/**
 * LINE add-friend link, only when the value looks like a LINE ID:
 * personal IDs (4–20 of a-z 0-9 . _ -) -> https://line.me/R/ti/p/~<id>;
 * official accounts (@xxxx) -> https://line.me/R/ti/p/@xxxx.
 */
export function lineHref(lineId: string): string | null {
  const v = lineId.trim();
  if (/^@[a-z0-9._-]{3,20}$/i.test(v)) return `https://line.me/R/ti/p/${encodeURIComponent(v)}`;
  if (/^[a-z0-9._-]{4,20}$/i.test(v)) return `https://line.me/R/ti/p/~${encodeURIComponent(v.toLowerCase())}`;
  return null;
}

export function mailHref(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? `mailto:${email.trim()}` : null;
}

export function userLabel(u: UserRef | null | undefined): string {
  if (!u) return "ยังไม่มอบหมาย";
  return u.name || u.email;
}
