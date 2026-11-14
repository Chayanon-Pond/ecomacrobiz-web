/**
 * Post editor form model: Post <-> form state <-> PostInput, validation and
 * the reading-time estimate (same formula as Go service.EstimateReadingMinutes).
 */
import { bangkokInputToIso, isoToBangkokInput, SLUG_RE } from "@/lib/admin/format";
import type { Cover, Post, PostInput, PostStatus } from "@/lib/admin/types";

/** Limits enforced by the API (api/internal/service/posts.go). */
export const LIMITS = { title: 200, excerpt: 300, author: 100, seoTitle: 200, seoDescription: 400, alt: 300 } as const;
/** Recommended ranges shown next to the counters. */
export const RECOMMENDED = {
  seoTitle: [30, 60] as const,
  seoDescription: [70, 160] as const,
  excerpt: [80, 200] as const,
};

export type PostForm = {
  title: string;
  slug: string;
  excerpt: string;
  body_markdown: string;
  categories: string[];
  author: string;
  /** Target status (what the primary action will save). */
  status: PostStatus;
  /** datetime-local value in Asia/Bangkok. */
  published_at: string;
  featured: boolean;
  seo_title: string;
  seo_description: string;
  cover: Cover | null;
  cover_media_id: string | null;
};

export const EMPTY_FORM: PostForm = {
  title: "",
  slug: "",
  excerpt: "",
  body_markdown: "",
  categories: [],
  author: "",
  status: "draft",
  published_at: "",
  featured: false,
  seo_title: "",
  seo_description: "",
  cover: null,
  cover_media_id: null,
};

export function formFromPost(p: Post): PostForm {
  return {
    title: p.title ?? "",
    slug: p.slug ?? "",
    excerpt: p.excerpt ?? "",
    body_markdown: p.body_markdown ?? "",
    categories: (p.categories ?? []).map((c) => c.slug),
    author: p.author ?? "",
    status: p.status ?? "draft",
    published_at: isoToBangkokInput(p.published_at),
    featured: Boolean(p.featured),
    seo_title: p.seo_title ?? "",
    seo_description: p.seo_description ?? "",
    cover: p.cover ? { ...p.cover, alt: p.cover.alt ?? "" } : null,
    cover_media_id: p.cover_media_id ?? null,
  };
}

/** reading_minutes is left to the API (same formula as estimateReadingMinutes). */
export function toInput(f: PostForm): PostInput {
  const out: PostInput = {
    slug: f.slug.trim(),
    title: f.title.trim(),
    excerpt: f.excerpt.trim(),
    body_markdown: f.body_markdown,
    cover: f.cover ? { ...f.cover, alt: f.cover.alt.trim() } : null,
    cover_media_id: f.cover ? f.cover_media_id : null,
    categories: f.categories,
    author: f.author.trim(),
    status: f.status,
    featured: f.featured,
    reading_minutes: null,
    seo_title: f.seo_title.trim(),
    seo_description: f.seo_description.trim(),
  };
  // null keeps the stored date on update; published without a date = now (API).
  out.published_at = bangkokInputToIso(f.published_at);
  return out;
}

const runes = (s: string) => [...s].length;

/** Field errors keyed like the form ("cover_alt" for cover.alt). `now` = Date.now(). */
export function validateForm(f: PostForm, now: number): Record<string, string> {
  const e: Record<string, string> = {};
  const title = f.title.trim();
  if (!title) e.title = "กรุณากรอกชื่อเรื่อง";
  else if (runes(title) > LIMITS.title) e.title = `ชื่อเรื่องยาวเกิน ${LIMITS.title} ตัวอักษร`;
  const slug = f.slug.trim();
  if (!slug) e.slug = "กรุณากรอก slug (ส่วนท้ายของ URL)";
  else if (!SLUG_RE.test(slug)) e.slug = "ใช้ได้เฉพาะ a-z, 0-9 และขีดกลางคั่น เช่น branding-vs-marketing";
  if (runes(f.excerpt.trim()) > LIMITS.excerpt) e.excerpt = `บทคัดย่อยาวเกิน ${LIMITS.excerpt} ตัวอักษร`;
  if (!f.body_markdown.trim()) e.body_markdown = "กรุณาเขียนเนื้อหาบทความ";
  if (runes(f.author.trim()) > LIMITS.author) e.author = `ชื่อผู้เขียนยาวเกิน ${LIMITS.author} ตัวอักษร`;
  if (runes(f.seo_title.trim()) > LIMITS.seoTitle) e.seo_title = `SEO title ยาวเกิน ${LIMITS.seoTitle} ตัวอักษร`;
  if (runes(f.seo_description.trim()) > LIMITS.seoDescription) {
    e.seo_description = `SEO description ยาวเกิน ${LIMITS.seoDescription} ตัวอักษร`;
  }
  if (f.cover) {
    if (!f.cover.alt.trim()) e.cover_alt = "กรุณากรอกคำอธิบายรูปปก (alt text)";
    else if (runes(f.cover.alt.trim()) > LIMITS.alt) e.cover_alt = `คำอธิบายรูปยาวเกิน ${LIMITS.alt} ตัวอักษร`;
  }
  if (f.published_at && !bangkokInputToIso(f.published_at)) e.published_at = "รูปแบบวันเวลาไม่ถูกต้อง";
  if (f.status === "scheduled") {
    const iso = bangkokInputToIso(f.published_at);
    if (!iso) e.published_at = "กรุณาเลือกวันและเวลาที่จะเผยแพร่";
    else if (Date.parse(iso) <= now) e.published_at = "เวลาเผยแพร่ต้องอยู่ในอนาคต";
  }
  return e;
}

/** Autosave needs only what the API requires for any draft. */
export function canAutosave(f: PostForm): boolean {
  return Boolean(f.title.trim()) && SLUG_RE.test(f.slug.trim()) && Boolean(f.body_markdown.trim());
}

/** API field keys -> form error slots ("cover.alt" -> "cover_alt"). */
export function mapServerFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.replace(/\./g, "_").replace(/\[\d+\]/g, "");
    out[key === "cover_url" || key === "cover_media_id" ? "cover" : key] = v;
  }
  return out;
}

export const FIELD_LABEL: Record<string, string> = {
  title: "ชื่อเรื่อง",
  slug: "Slug",
  excerpt: "บทคัดย่อ",
  body_markdown: "เนื้อหา",
  categories: "หมวดหมู่",
  author: "ผู้เขียน",
  status: "สถานะ",
  published_at: "วันเวลาเผยแพร่",
  seo_title: "SEO title",
  seo_description: "SEO description",
  cover: "รูปปก",
  cover_alt: "คำอธิบายรูปปก",
};

/**
 * Same as Go EstimateReadingMinutes: ~200 words/min for space-separated
 * scripts + ~800 Thai chars/min, at least 1. Word = whitespace-separated field.
 */
export function estimateReadingMinutes(body: string): number {
  let words = 0;
  let thai = 0;
  for (const field of body.split(/\s+/)) {
    if (!field) continue;
    words++;
    for (const ch of field) {
      const c = ch.codePointAt(0) ?? 0;
      if (c >= 0x0e00 && c <= 0x0e7f) thai++;
    }
  }
  return Math.max(1, Math.floor(words / 200) + Math.floor(thai / 800));
}
