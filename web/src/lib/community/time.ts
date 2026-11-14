/**
 * Thai relative time for comments (Facebook style):
 *   < 1 min "เมื่อสักครู่", "5 นาที", "3 ชม.", "2 วัน", "5 สัปดาห์",
 *   then the Thai short date ("9 พ.ย." this year, "9 พ.ย. 2568" otherwise).
 * Pure: `now` is passed in so server renders (cached, see server.ts
 * `fetchedAt`) and tests are deterministic. Asia/Bangkok, Buddhist calendar.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
/** Weeks are shown up to 8 weeks, then the date. */
const WEEKS_LIMIT = 8 * WEEK;

const TZ = "Asia/Bangkok";

const dayMonth = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", timeZone: TZ });
const dayMonthYear = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: TZ,
});
const yearOnly = new Intl.DateTimeFormat("th-TH", { year: "numeric", timeZone: TZ });
const full = new Intl.DateTimeFormat("th-TH", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: TZ,
});

function toMs(value: string | number | Date): number {
  if (typeof value === "number") return value;
  if (value instanceof Date) return value.getTime();
  return new Date(value).getTime();
}

/** Thai short date: "9 พ.ย." (same Thai year as `now`) or "9 พ.ย. 2568". */
export function thaiShortDate(iso: string | number | Date, now: string | number | Date = Date.now()): string {
  const t = toMs(iso);
  if (Number.isNaN(t)) return "";
  const sameYear = yearOnly.format(t) === yearOnly.format(toMs(now));
  return (sameYear ? dayMonth : dayMonthYear).format(t);
}

export function relativeTimeTh(iso: string | number | Date, now: string | number | Date = Date.now()): string {
  const t = toMs(iso);
  const n = toMs(now);
  if (Number.isNaN(t) || Number.isNaN(n)) return "";
  // Small clock skew between API and browser: a future timestamp is "now".
  const diff = Math.max(0, n - t);
  if (diff < MINUTE) return "เมื่อสักครู่";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} นาที`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)} ชม.`;
  if (diff < WEEK) return `${Math.floor(diff / DAY)} วัน`;
  if (diff < WEEKS_LIMIT) return `${Math.floor(diff / WEEK)} สัปดาห์`;
  return thaiShortDate(t, n);
}

/** Full timestamp for tooltips: "14 พฤศจิกายน 2569 เวลา 17:46 น.". */
export function fullThaiDateTime(iso: string | number | Date): string {
  const t = toMs(iso);
  if (Number.isNaN(t)) return "";
  const parts = full.formatToParts(t);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} เวลา ${get("hour")}:${get("minute")} น.`;
}
