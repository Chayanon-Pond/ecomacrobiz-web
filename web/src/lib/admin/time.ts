/** Time helpers for the admin (display in Asia/Bangkok, Thai locale). */

const TZ = "Asia/Bangkok";

const dayShort = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short" });
const dayLong = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" });
const absFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});
const todayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: TZ, weekday: "long", day: "numeric", month: "long", year: "numeric" });
const rtf = new Intl.RelativeTimeFormat("th-TH", { numeric: "auto" });

function ymdToUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/** "2026-11-14" -> "14 พ.ย." */
export function ymdShort(ymd: string): string {
  const t = ymdToUtc(ymd);
  return t === null ? ymd : dayShort.format(t);
}

/** "2026-11-14" -> "ส. 14 พ.ย. 2569" */
export function ymdLong(ymd: string): string {
  const t = ymdToUtc(ymd);
  return t === null ? ymd : dayLong.format(t);
}

/** Absolute timestamp incl. seconds, Bangkok. */
export function formatAbsolute(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "—" : absFmt.format(t);
}

/** "3 นาทีที่แล้ว", "เมื่อวาน", "ในอีก 2 ชั่วโมง". `now` injectable for tests. */
export function formatRelative(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = (t - now) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return "เมื่อสักครู่";
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(Math.round(diff / 86400), "day");
  if (abs < 86400 * 365) return rtf.format(Math.round(diff / (86400 * 30)), "month");
  return rtf.format(Math.round(diff / (86400 * 365)), "year");
}

/** Today's date in Bangkok, long Thai form. */
export function todayLong(now = Date.now()): string {
  return todayFmt.format(now);
}

/** Today's date in Bangkok as YYYY-MM-DD (for date inputs). */
export function bangkokYmd(now = Date.now()): string {
  return new Date(now + 7 * 3600 * 1000).toISOString().slice(0, 10);
}
