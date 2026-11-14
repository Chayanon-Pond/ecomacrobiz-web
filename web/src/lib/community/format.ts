/**
 * Engagement number formatting shared by the server-rendered cards/article
 * and the client island (pure, deterministic: no Intl locale differences
 * between Node and browsers for the visible text).
 */
import type { Stats } from "./types";

function trimDecimal(n: number): string {
  // 1 decimal, floored (1,299 -> 1.2K, never rounds up to a unit it hasn't reached).
  const v = Math.floor(n * 10) / 10;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

/** 999 -> "999", 1234 -> "1.2K", 12_500 -> "12K", 1_250_000 -> "1.2M". */
export function compactNumber(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  if (n < 1000) return String(n);
  if (n < 10_000) return `${trimDecimal(n / 1000)}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  if (n < 10_000_000) return `${trimDecimal(n / 1_000_000)}M`;
  return `${Math.floor(n / 1_000_000)}M`;
}

/** Full number with thousands separators for screen readers: 1234 -> "1,234". */
export function fullNumber(value: number): string {
  const n = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export const statLabels = {
  views: (n: number) => `ยอดเข้าชม ${fullNumber(n)} ครั้ง`,
  comments: (n: number) => `ความคิดเห็น ${fullNumber(n)} รายการ`,
  likes: (n: number) => `ถูกใจ ${fullNumber(n)} ครั้ง`,
} as const;

export const ZERO_STATS: Stats = Object.freeze({ views: 0, likes: 0, comments: 0 });
