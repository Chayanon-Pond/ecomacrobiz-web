/**
 * Live on-page SEO checks for the post editor. Advisory only: nothing here
 * blocks saving or publishing.
 *
 * The body is parsed with the same remark pipeline as the public renderer
 * (editor/markdown.ts), so headings/links/images are what the site renders.
 * Thai has no spaces between words, so keyword matching is substring-based on
 * NFC-normalized lowercase text (also tried with all whitespace removed).
 */
import type { Definition, Nodes, Root } from "mdast";
import type { Cover } from "@/lib/admin/types";
import { parseMarkdown } from "../editor/markdown";
import { estimateReadingMinutes } from "./post-form";
import { SERP_DESC_LINE_PX, SERP_TITLE_PX, serpWidth, visibleLength } from "./serp-width";
import { slugify } from "./slug";

export const SITE_NAME = "ECOMACROBIZ";
export const TITLE_SUFFIX = ` | ${SITE_NAME}`;
const SITE_HOSTS = ["ecomacrobiz.com", "www.ecomacrobiz.com"];

export type CheckStatus = "pass" | "warn" | "fail";
export type CheckGroup = "keyword" | "meta" | "content" | "links" | "media";

export const GROUP_LABEL: Record<CheckGroup, string> = {
  keyword: "คีย์เวิร์ดหลัก",
  meta: "ชื่อและคำอธิบายบน Google",
  content: "โครงสร้างเนื้อหา",
  links: "ลิงก์",
  media: "รูปภาพ",
};

export type SeoCheck = {
  id: string;
  group: CheckGroup;
  label: string;
  status: CheckStatus;
  /** Measured value ("54 ตัวอักษร · ≈ 540/600 px"). */
  detail?: string;
  /** How to fix (Thai). Shown when not passing. */
  hint?: string;
  weight: number;
};

export type LinkFact = { href: string; text: string };
export type ImageFact = { src: string; alt: string };
export type HeadingFact = { depth: number; text: string };

export type ContentFacts = {
  headings: HeadingFact[];
  images: ImageFact[];
  internal: LinkFact[];
  external: LinkFact[];
  /** Plain text of the first non-empty paragraph. */
  firstParagraph: string;
  text: string;
  words: number;
  readingMinutes: number;
};

export type SeoInput = {
  title: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  slug: string;
  focusKeyword: string;
  cover: Cover | null;
  noindex: boolean;
  canonicalUrl: string;
};

export type SeoReport = { score: number; checks: SeoCheck[]; facts: ContentFacts };

/* ---------------- text helpers ---------------- */

const ZERO_WIDTH = /[​-‍⁠﻿]/g;
export const THAI_RE = /[฀-๿]/;

export function normText(s: string): string {
  return s.normalize("NFC").replace(ZERO_WIDTH, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Keyword occurs in text (also when spacing differs: "การตลาด ออนไลน์" vs "การตลาดออนไลน์"). */
export function containsKeyword(text: string, keyword: string): boolean {
  const k = normText(keyword);
  if (!k) return false;
  const t = normText(text);
  if (t.includes(k)) return true;
  return t.replace(/ /g, "").includes(k.replace(/ /g, ""));
}

function countWords(text: string): number {
  const Seg = (Intl as unknown as { Segmenter?: typeof Intl.Segmenter }).Segmenter;
  if (Seg) {
    let n = 0;
    for (const s of new Seg("th", { granularity: "word" }).segment(text)) if (s.isWordLike) n++;
    return n;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/* ---------------- markdown facts ---------------- */

const INLINE_PARENTS = new Set(["paragraph", "heading", "link", "linkReference", "emphasis", "strong", "delete", "tableCell"]);

function textOf(node: Nodes): string {
  if ("value" in node && typeof node.value === "string" && node.type !== "html") return node.value;
  if (node.type === "image") return "";
  if ("children" in node) return (node.children as Nodes[]).map(textOf).join(INLINE_PARENTS.has(node.type) ? "" : " ");
  return "";
}

const ASSET_RE = /\.(png|jpe?g|webp|gif|svg|avif|pdf|zip)(\?|#|$)/i;

export function isInternalHref(href: string): boolean {
  if (href.startsWith("/") && !href.startsWith("//")) return !ASSET_RE.test(href);
  try {
    const u = new URL(href);
    return (u.protocol === "https:" || u.protocol === "http:") && SITE_HOSTS.includes(u.hostname) && !ASSET_RE.test(u.pathname);
  } catch {
    return false;
  }
}

function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href) && !isInternalHref(href);
}

export function pathOf(href: string): string {
  try {
    return decodeURI(new URL(href, "https://www.ecomacrobiz.com").pathname).replace(/\/+$/, "") || "/";
  } catch {
    return href;
  }
}

export function extractFacts(markdown: string): ContentFacts {
  let root: Root;
  try {
    root = parseMarkdown(markdown);
  } catch {
    root = { type: "root", children: [] };
  }
  const defs = new Map<string, Definition>();
  const headings: HeadingFact[] = [];
  const images: ImageFact[] = [];
  const links: LinkFact[] = [];
  const paragraphs: string[] = [];

  const collectDefs = (n: Nodes) => {
    if (n.type === "definition") defs.set(n.identifier.toLowerCase(), n);
    if ("children" in n) (n.children as Nodes[]).forEach(collectDefs);
  };
  collectDefs(root);

  const walk = (n: Nodes, inParagraphTop: boolean) => {
    switch (n.type) {
      case "heading":
        headings.push({ depth: n.depth, text: textOf(n).trim() });
        break;
      case "paragraph": {
        const t = textOf(n).trim();
        if (inParagraphTop && t) paragraphs.push(t);
        break;
      }
      case "image":
        images.push({ src: n.url, alt: (n.alt ?? "").trim() });
        return;
      case "imageReference": {
        const d = defs.get(n.identifier.toLowerCase());
        images.push({ src: d?.url ?? "", alt: (n.alt ?? "").trim() });
        return;
      }
      case "link":
        links.push({ href: n.url, text: textOf(n).trim() });
        break;
      case "linkReference": {
        const d = defs.get(n.identifier.toLowerCase());
        if (d) links.push({ href: d.url, text: textOf(n).trim() });
        break;
      }
      case "html": {
        // Raw HTML is rare in posts; still count <img> without alt and <h1>.
        for (const m of n.value.matchAll(/<img\b[^>]*>/gi)) {
          const alt = /\balt\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? "";
          images.push({ src: /\bsrc\s*=\s*"([^"]*)"/i.exec(m[0])?.[1] ?? "", alt: alt.trim() });
        }
        for (const m of n.value.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)) {
          headings.push({ depth: Number(m[1]), text: m[2].replace(/<[^>]+>/g, "").trim() });
        }
        return;
      }
    }
    if ("children" in n) for (const c of n.children as Nodes[]) walk(c, n.type === "root");
  };
  walk(root, true);

  const text = textOf(root).replace(/\s+/g, " ").trim();
  const internal: LinkFact[] = [];
  const external: LinkFact[] = [];
  for (const l of links) {
    if (isInternalHref(l.href)) internal.push(l);
    else if (isExternalHref(l.href)) external.push(l);
  }
  return {
    headings,
    images,
    internal,
    external,
    firstParagraph: paragraphs[0] ?? "",
    text,
    words: countWords(text),
    readingMinutes: estimateReadingMinutes(markdown),
  };
}

/* ---------------- checks ---------------- */

const FACTOR: Record<CheckStatus, number> = { pass: 1, warn: 0.5, fail: 0 };

export function effectiveTitle(i: Pick<SeoInput, "seoTitle" | "title">): string {
  return (i.seoTitle.trim() || i.title.trim()) + TITLE_SUFFIX;
}

export function analyzeSeo(input: SeoInput, facts: ContentFacts): SeoReport {
  const checks: SeoCheck[] = [];
  const add = (c: SeoCheck) => checks.push(c);
  const kw = input.focusKeyword.trim();
  const seoTitle = input.seoTitle.trim() || input.title.trim();
  const fullTitle = effectiveTitle(input);
  const desc = input.seoDescription.trim() || input.excerpt.trim();
  const slug = input.slug.trim();

  /* keyword */
  if (!kw) {
    add({
      id: "kw-set",
      group: "keyword",
      label: "ตั้งคีย์เวิร์ดหลัก (Focus keyword)",
      status: "fail",
      hint: "ใส่คำที่คาดว่าคนจะค้นใน Google เช่น “แบรนด์ดิ้ง” เพื่อให้ระบบตรวจตำแหน่งสำคัญให้",
      weight: 25,
    });
  } else {
    const inSeoTitle = containsKeyword(seoTitle, kw);
    add({
      id: "kw-title",
      group: "keyword",
      label: "คีย์เวิร์ดอยู่ใน SEO title",
      status: inSeoTitle ? "pass" : containsKeyword(input.title, kw) ? "warn" : "fail",
      hint: inSeoTitle
        ? undefined
        : "ใส่คีย์เวิร์ดใน SEO title โดยเฉพาะช่วงต้นของชื่อ — ผู้ค้นหาจะเห็นคำที่ตรงกับที่ค้นเป็นตัวหนา",
      weight: 8,
    });

    const kwSlug = slugify(kw);
    const latinTokens = normText(kw).match(/[a-z0-9]+/g) ?? [];
    const slugMatch =
      (kwSlug !== "" && slug.includes(kwSlug)) || (latinTokens.length > 0 && latinTokens.every((t) => slug.includes(t)));
    const thaiOnly = THAI_RE.test(kw) && latinTokens.length === 0;
    add({
      id: "kw-slug",
      group: "keyword",
      label: "Slug สื่อถึงคีย์เวิร์ด",
      status: slugMatch ? "pass" : "warn",
      detail: slug ? `/knowledge/${slug}` : undefined,
      hint: slugMatch
        ? undefined
        : thaiOnly
          ? `ระบบตรวจคำแปลไม่ได้ — ตรวจเองว่า slug เป็นคำภาษาอังกฤษที่สื่อความหมายของ “${kw}” (ถ้าใช่ ข้อนี้ข้ามได้)`
          : "ใส่คำภาษาอังกฤษจากคีย์เวิร์ดใน slug คั่นด้วยขีดกลาง",
      weight: 4,
    });

    const first = facts.firstParagraph;
    add({
      id: "kw-first",
      group: "keyword",
      label: "คีย์เวิร์ดอยู่ในย่อหน้าแรก",
      status: !first ? "fail" : containsKeyword(first, kw) ? "pass" : containsKeyword(facts.text.slice(0, 600), kw) ? "warn" : "fail",
      hint: "กล่าวถึงคีย์เวิร์ดตั้งแต่ย่อหน้าแรก ให้ผู้อ่านและ Google รู้ทันทีว่าบทความตอบเรื่องอะไร",
      weight: 6,
    });

    const sub = facts.headings.filter((h) => h.depth >= 2);
    const inH2 = sub.some((h) => h.depth === 2 && containsKeyword(h.text, kw));
    const inH3 = sub.some((h) => h.depth > 2 && containsKeyword(h.text, kw));
    add({
      id: "kw-h2",
      group: "keyword",
      label: "คีย์เวิร์ดอยู่ในหัวข้อย่อย (H2) อย่างน้อย 1 หัวข้อ",
      status: inH2 ? "pass" : inH3 ? "warn" : "fail",
      hint: inH2 ? undefined : "ตั้งหัวข้อ H2 สักหัวข้อที่มีคีย์เวิร์ดหรือคำใกล้เคียงอย่างเป็นธรรมชาติ",
      weight: 4,
    });

    add({
      id: "kw-desc",
      group: "keyword",
      label: "คีย์เวิร์ดอยู่ใน meta description",
      status: containsKeyword(desc, kw) ? "pass" : "warn",
      hint: "ใส่คีย์เวิร์ดในคำอธิบาย — Google มักทำตัวหนาคำที่ตรงกับคำค้น ช่วยให้คนคลิกมากขึ้น",
      weight: 3,
    });
  }

  /* meta */
  const titleChars = visibleLength(fullTitle);
  const titlePx = serpWidth(fullTitle, 20);
  add({
    id: "title-len",
    group: "meta",
    label: "ความยาว SEO title เหมาะสม (~50–60 ตัวอักษร, ไม่เกิน ~600 px)",
    status: !input.title.trim() && !input.seoTitle.trim() ? "fail" : titlePx > SERP_TITLE_PX ? "warn" : titleChars < 30 ? "warn" : "pass",
    detail: `${titleChars} ตัวอักษร (รวม “${TITLE_SUFFIX.trim()}”) · ≈ ${titlePx}/${SERP_TITLE_PX} px`,
    hint:
      titlePx > SERP_TITLE_PX
        ? "ยาวเกินพื้นที่ที่ Google แสดง ท้ายชื่อจะถูกตัดเป็น “…” — ย่อให้สั้นลงและเอาคำสำคัญไว้ช่วงต้น"
        : titleChars < 30
          ? "สั้นเกินไป เพิ่มรายละเอียดที่ช่วยให้คนอยากคลิก เช่น ประโยชน์หรือกลุ่มผู้อ่าน"
          : undefined,
    weight: 10,
  });

  const descChars = visibleLength(desc);
  const descPx = serpWidth(desc, 14);
  const descOk = descChars >= 120 && descChars <= 160;
  add({
    id: "desc-len",
    group: "meta",
    label: "Meta description ยาว ~120–160 ตัวอักษร",
    status: !desc ? "fail" : descOk && input.seoDescription.trim() ? "pass" : "warn",
    detail: desc
      ? `${descChars} ตัวอักษร · ≈ ${Math.max(1, Math.ceil(descPx / SERP_DESC_LINE_PX))} บรรทัดบน Google${input.seoDescription.trim() ? "" : " · ใช้บทคัดย่อแทน"}`
      : undefined,
    hint: !desc
      ? "เขียนคำอธิบาย 1–2 ประโยคที่สรุปว่าผู้อ่านจะได้อะไรจากบทความ"
      : !input.seoDescription.trim()
        ? "ยังไม่ได้เขียน SEO description — ตอนนี้ใช้บทคัดย่อแทน แนะนำให้เขียนแยกให้ตรงกับการค้นหา"
        : descChars < 120
          ? "สั้นไป Google อาจดึงข้อความจากเนื้อหามาแสดงแทน — เพิ่มรายละเอียดอีกเล็กน้อย"
          : descChars > 160
            ? "ยาวเกิน ส่วนท้ายอาจถูกตัด — เอาใจความสำคัญไว้ช่วงต้น"
            : undefined,
    weight: 10,
  });

  add({
    id: "indexable",
    group: "meta",
    label: "Google เก็บหน้านี้ได้ (ไม่ได้ตั้ง noindex)",
    status: input.noindex ? "fail" : "pass",
    hint: input.noindex ? "ตั้ง noindex อยู่ บทความจะไม่ขึ้นใน Google — ปิดตัวเลือกนี้หากต้องการให้ค้นเจอ" : undefined,
    weight: 5,
  });

  const canonical = input.canonicalUrl.trim();
  if (canonical) {
    const self = slug && pathOf(canonical) === `/knowledge/${slug}` && isInternalHref(canonical);
    add({
      id: "canonical",
      group: "meta",
      label: "Canonical ชี้มาที่บทความนี้",
      status: self ? "pass" : "warn",
      detail: canonical,
      hint: self ? undefined : "Canonical ชี้ไป URL อื่น Google จะจัดอันดับ URL นั้นแทนหน้านี้ — ใช้เฉพาะเมื่อบทความนี้ซ้ำกับต้นฉบับที่อื่น",
      weight: 3,
    });
  }

  /* content */
  const h1s = facts.headings.filter((h) => h.depth === 1);
  add({
    id: "h1",
    group: "content",
    label: "มี H1 เดียวคือชื่อเรื่อง (เนื้อหาไม่มี H1)",
    status: h1s.length === 0 ? "pass" : "fail",
    detail: h1s.length ? `พบ H1 ในเนื้อหา ${h1s.length} หัวข้อ: “${h1s[0].text.slice(0, 40)}”` : undefined,
    hint: h1s.length ? "ชื่อเรื่องเป็น H1 ของหน้าอยู่แล้ว — เปลี่ยนหัวข้อในเนื้อหาเป็น H2" : undefined,
    weight: 8,
  });

  const skips: string[] = [];
  let prev = 1;
  for (const h of facts.headings) {
    if (h.depth === 1) continue;
    if (h.depth > prev + 1) skips.push(`H${prev} → H${h.depth} “${h.text.slice(0, 30)}”`);
    prev = h.depth;
  }
  const subCount = facts.headings.filter((h) => h.depth >= 2).length;
  add({
    id: "hierarchy",
    group: "content",
    label: "ลำดับหัวข้อไม่ข้ามระดับ (H2 → H3 → H4)",
    status: skips.length ? "warn" : subCount === 0 && facts.words > 300 ? "warn" : "pass",
    detail: skips.length ? skips.slice(0, 2).join(" · ") : `หัวข้อย่อย ${subCount} หัวข้อ`,
    hint: skips.length
      ? "อย่าข้ามระดับหัวข้อ เช่น จาก H2 ไป H4 — โปรแกรมอ่านหน้าจอและ Google ใช้ลำดับนี้เข้าใจโครงสร้าง"
      : subCount === 0 && facts.words > 300
        ? "แบ่งเนื้อหายาวด้วยหัวข้อ H2 ช่วยให้อ่านง่ายและอาจได้ลิงก์ย่อยใน Google"
        : undefined,
    weight: 5,
  });

  add({
    id: "length",
    group: "content",
    label: "ความยาวเนื้อหาเพียงพอ",
    status: facts.words >= 600 ? "pass" : facts.words >= 300 ? "warn" : "fail",
    detail: `≈ ${facts.words.toLocaleString("th-TH")} คำ · อ่าน ${facts.readingMinutes} นาที`,
    hint: facts.words < 600 ? "บทความความรู้ควรยาวพอจะตอบคำถามได้ครบ (แนะนำ 600 คำขึ้นไป) — เน้นคุณภาพมากกว่าจำนวน" : undefined,
    weight: 8,
  });

  /* links */
  const internalCount = facts.internal.filter((l) => !slug || pathOf(l.href) !== `/knowledge/${slug}`).length;
  add({
    id: "internal",
    group: "links",
    label: "มีลิงก์ภายในเว็บไซต์อย่างน้อย 2 ลิงก์",
    status: internalCount >= 2 ? "pass" : internalCount === 1 ? "warn" : "fail",
    detail: `${internalCount} ลิงก์`,
    hint: internalCount >= 2 ? undefined : "ลิงก์ไปบทความที่เกี่ยวข้องใน /knowledge หรือหน้าบริการ ช่วยให้ Google ค้นพบหน้าอื่นและผู้อ่านอยู่นานขึ้น — ดูคำแนะนำด้านล่าง",
    weight: 8,
  });

  const insecure = facts.external.filter((l) => /^http:\/\//i.test(l.href));
  add({
    id: "external",
    group: "links",
    label: "อ้างอิงแหล่งข้อมูลภายนอก",
    status: insecure.length ? "warn" : facts.external.length ? "pass" : "warn",
    detail: `${facts.external.length} ลิงก์${insecure.length ? ` · ${insecure.length} ลิงก์ยังเป็น http://` : ""}`,
    hint: insecure.length
      ? "เปลี่ยนลิงก์ http:// เป็น https:// ถ้าเว็บปลายทางรองรับ"
      : facts.external.length
        ? undefined
        : "อ้างอิงแหล่งข้อมูลที่น่าเชื่อถือ (งานวิจัย หน่วยงาน) ช่วยเรื่องความน่าเชื่อถือของบทความ",
    weight: 2,
  });

  /* media */
  const noAlt = facts.images.filter((i) => !i.alt);
  const nonThaiAlt = facts.images.filter((i) => i.alt && !THAI_RE.test(i.alt));
  add({
    id: "img-alt",
    group: "media",
    label: "ทุกรูปในเนื้อหามีคำอธิบาย (alt) ภาษาไทย",
    status: noAlt.length ? "fail" : nonThaiAlt.length ? "warn" : "pass",
    detail: facts.images.length
      ? `${facts.images.length} รูป${noAlt.length ? ` · ไม่มี alt ${noAlt.length}` : ""}${nonThaiAlt.length ? ` · alt ไม่มีภาษาไทย ${nonThaiAlt.length}` : ""}`
      : "ไม่มีรูปในเนื้อหา",
    hint: noAlt.length
      ? "คลิกรูปในเนื้อหาแล้วกรอก ALT อธิบายว่าในภาพมีอะไร (ช่วยผู้พิการทางสายตาและ Google Images)"
      : nonThaiAlt.length
        ? "ผู้อ่านเป็นคนไทย แนะนำเขียน alt เป็นภาษาไทย"
        : undefined,
    weight: 6,
  });

  add({
    id: "cover",
    group: "media",
    label: "มีรูปปก",
    status: input.cover ? "pass" : "fail",
    hint: input.cover ? undefined : "รูปปกแสดงในการ์ดบทความและใช้เป็นรูปตอนแชร์ (แนะนำ 1200×630 px ขึ้นไป)",
    weight: 4,
  });
  if (input.cover) {
    const alt = input.cover.alt.trim();
    add({
      id: "cover-alt",
      group: "media",
      label: "รูปปกมีคำอธิบาย (alt) ภาษาไทย",
      status: !alt ? "fail" : THAI_RE.test(alt) ? "pass" : "warn",
      hint: !alt ? "กรอกคำอธิบายรูปปกในส่วน “รูปปก”" : THAI_RE.test(alt) ? undefined : "แนะนำเขียนคำอธิบายรูปปกเป็นภาษาไทย",
      weight: 3,
    });
  }

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.reduce((s, c) => s + c.weight * FACTOR[c.status], 0);
  return { score: total ? Math.round((got / total) * 100) : 0, checks, facts };
}
