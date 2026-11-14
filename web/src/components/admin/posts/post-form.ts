/**
 * Post editor form model: Post <-> form state <-> PostInput, validation and
 * the reading-time estimate (same formula as Go service.EstimateReadingMinutes).
 */
import { bangkokInputToIso, isoToBangkokInput, SLUG_RE } from "@/lib/admin/format";
import type { Cover, Post, PostInput, PostStatus } from "@/lib/admin/types";

/** Limits enforced by the API (api/internal/service/posts.go). */
export const LIMITS = { title: 200, excerpt: 300, author: 100, seoTitle: 200, seoDescription: 400, alt: 300, focusKeyword: 100, canonical: 2000 } as const;
/** Recommended ranges shown next to the counters. */
export const RECOMMENDED = {
  /** Without the " | ECOMACROBIZ" suffix (14 chars) the site appends: ~50–60 in total. */
  seoTitle: [35, 46] as const,
  seoDescription: [120, 160] as const,
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
  focus_keyword: string;
  canonical_url: string;
  noindex: boolean;
  /** Social share image override (null = use the cover / auto image). */
  og_image: Cover | null;
  og_media_id: string | null;
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
  focus_keyword: "",
  canonical_url: "",
  noindex: false,
  og_image: null,
  og_media_id: null,
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
    focus_keyword: p.focus_keyword ?? "",
    canonical_url: p.canonical_url ?? "",
    noindex: Boolean(p.noindex),
    og_image: p.og_image ? { ...p.og_image, alt: p.og_image.alt ?? "" } : null,
    og_media_id: p.og_media_id ?? null,
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
    focus_keyword: f.focus_keyword.trim(),
    canonical_url: f.canonical_url.trim(),
    noindex: f.noindex,
    og_image: f.og_image ? { ...f.og_image, alt: f.og_image.alt.trim() } : null,
    og_media_id: f.og_image ? f.og_media_id : null,
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
  if (runes(f.focus_keyword.trim()) > LIMITS.focusKeyword) e.focus_keyword = `คีย์เวิร์ดยาวเกิน ${LIMITS.focusKeyword} ตัวอักษร`;
  const canonical = canonicalError(f.canonical_url);
  if (canonical) e.canonical_url = canonical;
  if (f.og_image && runes(f.og_image.alt.trim()) > LIMITS.alt) e.og_image_alt = `คำอธิบายรูปยาวเกิน ${LIMITS.alt} ตัวอักษร`;
  if (f.published_at && !bangkokInputToIso(f.published_at)) e.published_at = "รูปแบบวันเวลาไม่ถูกต้อง";
  if (f.status === "scheduled") {
    const iso = bangkokInputToIso(f.published_at);
    if (!iso) e.published_at = "กรุณาเลือกวันและเวลาที่จะเผยแพร่";
    else if (Date.parse(iso) <= now) e.published_at = "เวลาเผยแพร่ต้องอยู่ในอนาคต";
  }
  return e;
}

/** Canonical override: empty, or an absolute https URL without spaces. */
export function canonicalError(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (runes(v) > LIMITS.canonical) return "URL ยาวเกินไป";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "กรุณากรอก URL เต็ม เช่น https://www.example.com/article";
  }
  if (u.protocol !== "https:") return "ต้องเป็น URL ที่ขึ้นต้นด้วย https://";
  if (/\s/.test(v) || !u.hostname.includes(".")) return "รูปแบบ URL ไม่ถูกต้อง";
  return null;
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
    out[key === "cover_url" || key === "cover_media_id" ? "cover" : key === "og_image_url" || key === "og_media_id" ? "og_image" : key] = v;
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
  focus_keyword: "คีย์เวิร์ดหลัก",
  canonical_url: "Canonical URL",
  noindex: "ไม่ให้ Google เก็บหน้า (noindex)",
  og_image: "รูปสำหรับแชร์",
  og_image_alt: "คำอธิบายรูปสำหรับแชร์",
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
