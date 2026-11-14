"use client";

import { Monitor, Smartphone } from "lucide-react";
import { useMemo, useState } from "react";
import { Field, Input, SegmentedControl, Textarea } from "../ui";
import { LIMITS, RECOMMENDED } from "./post-form";
import { SERP_DESC_LINE_PX, SERP_TITLE_PX, SITE_HOST, serpWidth } from "./serp-width";

const runes = (s: string) => [...s].length;

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
  const titlePx = useMemo(() => serpWidth(shownTitle, 20), [shownTitle]);
  const titleTooWide = titlePx > SERP_TITLE_PX;
  const descTooWide = useMemo(() => serpWidth(shownDesc, 14) > SERP_DESC_LINE_PX * 2, [shownDesc]);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Field
        label="SEO title"
        error={errors.seo_title}
        hint={
          <>
            <RangeCounter value={seoTitle} range={RECOMMENDED.seoTitle} max={LIMITS.seoTitle} /> · ≈ {titlePx}/{SERP_TITLE_PX} px บน Google · เว้นว่าง = ใช้ชื่อเรื่อง
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
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
            {titleTooWide ? `ชื่อเรื่องยาวเกินพื้นที่ที่ Google แสดง (~${SERP_TITLE_PX}px) จะถูกตัดด้วย “…”` : ""}
            {titleTooWide && descTooWide ? " · " : ""}
            {descTooWide ? "คำอธิบายยาวเกินประมาณ 2 บรรทัดที่ Google แสดง" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
