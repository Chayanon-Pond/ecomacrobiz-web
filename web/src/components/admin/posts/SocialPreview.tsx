"use client";

/**
 * Share image override + Facebook/LINE and X (summary_large_image) card
 * previews, and the advanced indexing fields (canonical, noindex).
 *
 * Image used when shared: og_image override, else the cover, else the
 * auto-generated card (lib/seo/og.ts generatedOgPath, "ภาพอัตโนมัติ").
 */
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import type { Cover } from "@/lib/admin/types";
import { generatedOgPath } from "@/lib/seo/og";
import { Badge, Field, Input, SegmentedControl } from "../ui";
import { CoverPicker } from "./PostFields";
import { canonicalError } from "./post-form";
import { SITE_HOST } from "./serp-width";

const OG_TEXT = {
  empty: "เลือกรูปสำหรับแชร์ (แนะนำ 1200×630 px)",
  picker: "เลือกรูปสำหรับแชร์",
  uploaded: "อัปโหลดรูปสำหรับแชร์แล้ว",
  alt: "คำอธิบายรูปสำหรับแชร์ (Alt text)",
  preview: "ตัวอย่างรูปสำหรับแชร์",
};

type Source = "override" | "cover" | "auto";

export function resolveShareImage(og: Cover | null, cover: Cover | null, slug: string): { url: string; source: Source } {
  if (og?.url) return { url: og.url, source: "override" };
  if (cover?.url) return { url: cover.url, source: "cover" };
  return { url: generatedOgPath(encodeURIComponent(slug || "_")), source: "auto" };
}

const SOURCE_LABEL: Record<Source, string> = { override: "รูปที่กำหนดเอง", cover: "รูปปก", auto: "ภาพอัตโนมัติ" };

export function SocialPanel({
  title,
  description,
  slug,
  cover,
  ogImage,
  errors,
  disabled,
  onOgChange,
}: {
  /** Share title (SEO title or title, without the site suffix). */
  title: string;
  description: string;
  slug: string;
  cover: Cover | null;
  ogImage: Cover | null;
  errors: Record<string, string>;
  disabled?: boolean;
  onOgChange: (og: Cover | null, mediaId?: string | null) => void;
}) {
  const [network, setNetwork] = useState<"facebook" | "x">("facebook");
  const img = resolveShareImage(ogImage, cover, slug);
  const shownTitle = title.trim() || "ชื่อเรื่องบทความ";
  const shownDesc = description.trim();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <p className="adm-label">รูปสำหรับแชร์ (ไม่บังคับ)</p>
        <p className="adm-hint -mt-1">
          เว้นว่าง = ใช้{cover ? "รูปปก" : "ภาพอัตโนมัติจากชื่อเรื่อง"} · กำหนดเองเมื่ออยากให้รูปบน Facebook/LINE/X ต่างจากรูปปก
        </p>
        <CoverPicker
          cover={ogImage}
          error={errors.og_image}
          altError={errors.og_image_alt}
          disabled={disabled}
          text={OG_TEXT}
          altRequired={false}
          onChange={onOgChange}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">ตัวอย่างเมื่อแชร์</p>
          <SegmentedControl
            label="เครือข่ายของตัวอย่าง"
            value={network}
            onChange={setNetwork}
            options={[
              { value: "facebook", label: "Facebook / LINE" },
              { value: "x", label: "X" },
            ]}
          />
        </div>
        {network === "facebook" ? (
          <div className="sp-fb" role="img" aria-label="ตัวอย่างการ์ดเมื่อแชร์บน Facebook หรือ LINE">
            <ShareImage url={img.url} source={img.source} title={shownTitle} ratio="1.91 / 1" />
            <div className="sp-fb-meta">
              <p className="sp-fb-host">{SITE_HOST.toUpperCase()}</p>
              <p className="sp-fb-title">{shownTitle}</p>
              {shownDesc ? <p className="sp-fb-desc">{shownDesc}</p> : null}
            </div>
          </div>
        ) : (
          <div className="sp-x" role="img" aria-label="ตัวอย่างการ์ดเมื่อแชร์บน X">
            <div className="sp-x-frame">
              <ShareImage url={img.url} source={img.source} title={shownTitle} ratio="2 / 1" />
              <span className="sp-x-title">{shownTitle}</span>
            </div>
            <p className="sp-x-host">จาก {SITE_HOST.replace(/^www\./, "")}</p>
          </div>
        )}
        <p className="adm-hint">
          รูปที่ใช้: <Badge tone={img.source === "auto" ? "violet" : "neutral"}>{SOURCE_LABEL[img.source]}</Badge>
          {img.source === "auto" ? " · สร้างจากชื่อเรื่องโดยอัตโนมัติเมื่อบทความเผยแพร่" : ""} · แพลตฟอร์มอาจเก็บรูปเดิมไว้ในแคช
          ใช้ Sharing Debugger ของ Facebook เพื่อดึงใหม่
        </p>
      </div>
    </div>
  );
}

function ShareImage({ url, source, title, ratio }: { url: string; source: Source; title: string; ratio: string }) {
  const [failed, setFailed] = useState<string | null>(null);
  const showMock = failed === url;
  return (
    <div className="sp-img" style={{ aspectRatio: ratio }}>
      {showMock ? (
        <div className="sp-auto" aria-hidden="true">
          <span className="sp-auto-brand">ECOMACROBIZ</span>
          <span className="sp-auto-title">{title}</span>
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" onError={() => setFailed(url)} />
      )}
      {source === "auto" ? <span className="sp-img-tag">ภาพอัตโนมัติ</span> : null}
    </div>
  );
}

export function IndexingFields({
  canonical,
  noindex,
  slug,
  errors,
  disabled,
  onCanonical,
  onNoindex,
}: {
  canonical: string;
  noindex: boolean;
  slug: string;
  errors: Record<string, string>;
  disabled?: boolean;
  onCanonical: (v: string) => void;
  onNoindex: (v: boolean) => void;
}) {
  const [touched, setTouched] = useState(false);
  const liveError = touched ? canonicalError(canonical) : null;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Field
        label="Canonical URL (ไม่บังคับ)"
        error={errors.canonical_url ?? liveError}
        hint={
          <>
            เว้นว่าง = ใช้ URL ของบทความนี้ (<span className="break-all">https://{SITE_HOST}/knowledge/{slug || "…"}</span>) ซึ่งถูกต้องเกือบทุกกรณี · กรอกเฉพาะเมื่อบทความนี้
            ซ้ำกับต้นฉบับที่เผยแพร่ที่อื่น และอยากให้ Google จัดอันดับต้นฉบับแทน
          </>
        }
      >
        {(p) => (
          <Input
            {...p}
            type="url"
            inputMode="url"
            className="font-mono"
            placeholder="https://"
            value={canonical}
            disabled={disabled}
            autoCapitalize="off"
            spellCheck={false}
            onChange={(e) => onCanonical(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </Field>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <label className="adm-check cursor-pointer">
          <input type="checkbox" checked={noindex} disabled={disabled} onChange={(e) => onNoindex(e.target.checked)} />
          ไม่ให้ Google เก็บหน้านี้ (noindex)
        </label>
        {noindex ? (
          <p className="sp-warn" role="note">
            <TriangleAlert size={14} aria-hidden="true" className="shrink-0" />
            <span>
              บทความนี้จะไม่แสดงในผลการค้นหา Google และถูกนำออกจาก sitemap แต่ยังเปิดได้จากลิงก์และหน้า Knowledge — ใช้กับหน้าที่ไม่ต้องการให้ค้นเจอ
              เช่น ประกาศชั่วคราว หากเปิดทิ้งไว้โดยไม่ตั้งใจ บทความจะหายจาก Google
            </span>
          </p>
        ) : (
          <p className="adm-hint">ปกติไม่ต้องเลือก — บทความจะถูก Google เก็บและแสดงในผลการค้นหาได้</p>
        )}
      </div>
    </div>
  );
}
