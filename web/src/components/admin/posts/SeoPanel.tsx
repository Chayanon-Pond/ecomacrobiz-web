"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { Field, Input, SegmentedControl, Textarea } from "../ui";
import { LIMITS, RECOMMENDED } from "./post-form";

const SITE_HOST = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.ecomacrobiz.com").replace(/^https?:\/\//, "").replace(/\/$/, "");

const runes = (s: string) => [...s].length;

let ctx: CanvasRenderingContext2D | null = null;
/** Rendered width in px (Google SERP uses Arial: 20px titles, 14px snippets on desktop). */
function textWidth(text: string, font: string): number {
  if (typeof document === "undefined") return 0;
  ctx ??= document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
}

/** Counter with recommended range: green inside, amber outside, red over the hard limit. */
export function RangeCounter({ value, range, max }: { value: string; range: readonly [number, number]; max: number }) {
  const n = runes(value.trim());
  const tone = n > max ? "over" : n === 0 ? "empty" : n < range[0] || n > range[1] ? "warn" : "ok";
  return (
    <span className="pe-counter" data-tone={tone}>
      {n}/{max} · แนะนำ {range[0]}–{range[1]}
    </span>
  );
}

export function SeoPanel({
  title,
  seoTitle,
  seoDescription,
  excerpt,
  slug,
  errors,
  disabled,
  onChange,
}: {
  title: string;
  seoTitle: string;
  seoDescription: string;
  excerpt: string;
  slug: string;
  errors: Record<string, string>;
  disabled?: boolean;
  onChange: (key: "seo_title" | "seo_description", value: string) => void;
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const shownTitle = (seoTitle.trim() || title.trim() || "ชื่อเรื่องบทความ") + " | ECOMACROBIZ";
  const shownDesc = seoDescription.trim() || excerpt.trim() || "คำอธิบายจะแสดงที่นี่ — Google อาจเลือกข้อความจากเนื้อหาแทนหากไม่มีคำอธิบาย";
  const titleTooWide = useMemo(() => textWidth(shownTitle, "20px Arial") > 600, [shownTitle]);
  const descTooWide = useMemo(() => textWidth(shownDesc, "14px Arial") > 920 * 2, [shownDesc]);

  return (
    <div className="grid gap-4">
      <Field
        label="SEO title"
        error={errors.seo_title}
        hint={
          <>
            <RangeCounter value={seoTitle} range={RECOMMENDED.seoTitle} max={LIMITS.seoTitle} /> · เว้นว่าง = ใช้ชื่อเรื่อง
          </>
        }
      >
        {(p) => (
          <Input {...p} value={seoTitle} disabled={disabled} placeholder={title} onChange={(e) => onChange("seo_title", e.target.value)} />
        )}
      </Field>
      <Field
        label="SEO description"
        error={errors.seo_description}
        hint={
          <>
            <RangeCounter value={seoDescription} range={RECOMMENDED.seoDescription} max={LIMITS.seoDescription} /> · เว้นว่าง = ใช้บทคัดย่อ
          </>
        }
      >
        {(p) => (
          <Textarea
            {...p}
            rows={3}
            value={seoDescription}
            disabled={disabled}
            placeholder={excerpt}
            onChange={(e) => onChange("seo_description", e.target.value)}
          />
        )}
      </Field>

      <div className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">ตัวอย่างบน Google</p>
          <SegmentedControl
            label="อุปกรณ์ของตัวอย่าง"
            value={device}
            onChange={setDevice}
            options={[
              { value: "desktop", label: "", icon: <Monitor size={14} aria-hidden="true" />, ariaLabel: "เดสก์ท็อป" },
              { value: "mobile", label: "", icon: <Smartphone size={14} aria-hidden="true" />, ariaLabel: "มือถือ" },
            ]}
          />
        </div>
        <div className="pe-serp" data-device={device} aria-label="ตัวอย่างผลการค้นหา Google" role="img">
          <div className="pe-serp-site">
            <span className="pe-serp-fav" aria-hidden="true">
              E
            </span>
            <span className="min-w-0">
              <span className="pe-serp-name">ECOMACROBIZ</span>
              <span className="pe-serp-url">
                {SITE_HOST} › knowledge › {slug || "…"}
              </span>
            </span>
          </div>
          <p className="pe-serp-title">{shownTitle}</p>
          <p className="pe-serp-desc">{shownDesc}</p>
        </div>
        {titleTooWide || descTooWide ? (
          <p className="adm-hint" data-warn="true">
            {titleTooWide ? "ชื่อเรื่องยาวเกินพื้นที่ที่ Google แสดง (~600px) จะถูกตัดด้วย “…”" : ""}
            {titleTooWide && descTooWide ? " · " : ""}
            {descTooWide ? "คำอธิบายยาวเกินประมาณ 2 บรรทัดที่ Google แสดง" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
