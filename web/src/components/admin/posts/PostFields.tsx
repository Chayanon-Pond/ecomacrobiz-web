"use client";

import { Check, ImagePlus, Images, Loader2, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SLUG_RE } from "@/lib/admin/format";
import type { Category, Cover, Media, SlugCheck } from "@/lib/admin/types";
import { MediaPickerDialog } from "../media/MediaPickerDialog";
import { IMAGE_ACCEPT, useMediaUpload } from "../media/upload";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Button, Field, Input, Skeleton, useToast } from "../ui";
import { LIMITS } from "./post-form";
import { slugify } from "./slug";

/* ---------------- slug ---------------- */

type CheckState = { kind: "idle" } | { kind: "checking" } | { kind: "done"; result: SlugCheck } | { kind: "error" };

export function SlugField({
  value,
  title,
  postId,
  auto,
  error,
  disabled,
  publishedSlug,
  onChange,
  onAutoChange,
}: {
  value: string;
  title: string;
  postId: string | null;
  /** true while the slug follows the title (new posts until edited by hand). */
  auto: boolean;
  error?: string;
  disabled?: boolean;
  /** Current live slug of a published post (warn when it changes). */
  publishedSlug?: string | null;
  onChange: (slug: string) => void;
  onAutoChange: (auto: boolean) => void;
}) {
  const { request } = useAdmin();
  const [check, setCheck] = useState<CheckState>({ kind: "idle" });
  const slug = value.trim();
  const formatOk = SLUG_RE.test(slug);

  useEffect(() => {
    if (!formatOk) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setCheck({ kind: "checking" });
      request<{ data: SlugCheck }>("posts/slug-check", {
        query: { slug, exclude_id: postId ?? undefined },
        signal: ctrl.signal,
      })
        .then((r) => setCheck({ kind: "done", result: r.data }))
        .catch((err) => {
          if (errorMessage(err)) setCheck({ kind: "error" });
        });
    }, 450);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [slug, formatOk, postId, request]);

  const result = check.kind === "done" && check.result.slug === slug ? check.result : null;
  const status = !slug ? null : !formatOk ? (
    <span className="pe-slug-status" data-tone="danger">
      <X size={13} aria-hidden="true" /> รูปแบบไม่ถูกต้อง
    </span>
  ) : check.kind === "checking" || (check.kind === "done" && !result) ? (
    <span className="pe-slug-status">
      <Loader2 size={13} aria-hidden="true" className="pe-spin" /> กำลังตรวจสอบ…
    </span>
  ) : result ? (
    result.available && result.valid ? (
      <span className="pe-slug-status" data-tone="success">
        <Check size={13} aria-hidden="true" /> ใช้ได้
      </span>
    ) : (
      <span className="pe-slug-status" data-tone="danger">
        <X size={13} aria-hidden="true" /> {result.valid ? "ถูกใช้แล้ว" : "ใช้ไม่ได้"}
      </span>
    )
  ) : check.kind === "error" ? (
    <span className="pe-slug-status">ตรวจสอบไม่ได้ (จะตรวจอีกครั้งตอนบันทึก)</span>
  ) : null;

  return (
    <div className="grid gap-1.5">
      <Field
        label="Slug (URL)"
        required
        error={error}
        hint={
          <>
            /knowledge/<strong className="text-fg">{slug || "…"}</strong> · a-z, 0-9 และขีดกลาง
            {auto ? " · สร้างจากชื่อเรื่องอัตโนมัติ (ภาษาไทยถอดเป็นอักษรโรมันแบบคร่าว ๆ แนะนำให้ปรับเป็นคำภาษาอังกฤษที่สื่อความหมาย)" : ""}
          </>
        }
      >
        {(p) => (
          <div className="pe-slug-row">
            <Input
              {...p}
              className="font-mono"
              value={value}
              disabled={disabled}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={120}
              onChange={(e) => {
                onAutoChange(false);
                onChange(e.target.value.toLowerCase().replace(/\s+/g, "-"));
              }}
            />
            {status}
          </div>
        )}
      </Field>
      <div className="flex flex-wrap gap-2">
        {result && !result.available && result.suggestion ? (
          <Button size="sm" onClick={() => onChange(result.suggestion)} disabled={disabled}>
            ใช้ “{result.suggestion}”
          </Button>
        ) : null}
        {!disabled && title.trim() ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw size={13} aria-hidden="true" />}
            onClick={() => {
              const s = slugify(title);
              if (s) onChange(s);
            }}
          >
            สร้างจากชื่อเรื่อง
          </Button>
        ) : null}
      </div>
      {publishedSlug && slug !== publishedSlug ? (
        <p className="adm-hint" data-warn="true">
          บทความนี้เผยแพร่แล้วที่ /knowledge/{publishedSlug} — เมื่อเปลี่ยน slug ลิงก์เดิมจะถูกส่งต่อ (legacy slug) ตามที่ API รองรับ
        </p>
      ) : null}
    </div>
  );
}

/* ---------------- cover ---------------- */

export function CoverPicker({
  cover,
  error,
  altError,
  disabled,
  onChange,
}: {
  cover: Cover | null;
  error?: string;
  altError?: string;
  disabled?: boolean;
  /** mediaId undefined = keep the current one (alt text edits). */
  onChange: (cover: Cover | null, mediaId?: string | null) => void;
}) {
  const upload = useMediaUpload();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function fromMedia(m: Media) {
    onChange({ url: m.url, width: m.width, height: m.height, alt: cover?.alt || m.alt || "" }, m.id);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setProgress(0);
    try {
      const m = await upload(file, { onProgress: setProgress });
      fromMedia(m);
      toast.success("อัปโหลดรูปปกแล้ว — อย่าลืมกรอกคำอธิบายรูป");
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "อัปโหลดไม่สำเร็จ");
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="grid gap-3">
      {cover ? (
        <div className="pe-cover">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover.url} alt={cover.alt || "ตัวอย่างรูปปก"} width={cover.width || undefined} height={cover.height || undefined} />
        </div>
      ) : progress !== null ? (
        <Skeleton className="pe-cover" />
      ) : (
        <button type="button" className="pe-cover pe-cover-empty" disabled={disabled} onClick={() => setPickerOpen(true)}>
          <ImagePlus size={22} aria-hidden="true" />
          <span>เลือกรูปปก (แนะนำ 1600×900 px ขึ้นไป)</span>
        </button>
      )}
      {progress !== null ? (
        <div className="md-progress" role="progressbar" aria-label="อัปโหลดรูปปก" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {!disabled ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Images size={14} aria-hidden="true" />} onClick={() => setPickerOpen(true)}>
            คลังสื่อ
          </Button>
          <Button size="sm" icon={<ImagePlus size={14} aria-hidden="true" />} onClick={() => input.current?.click()} loading={progress !== null}>
            อัปโหลด
          </Button>
          {cover ? (
            <Button size="sm" variant="ghost" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => onChange(null, null)}>
              นำออก
            </Button>
          ) : null}
          <input
            ref={input}
            type="file"
            accept={IMAGE_ACCEPT}
            className="adm-sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      ) : null}
      {error ? <p className="adm-field-error">{error}</p> : null}
      {cover ? (
        <Field label="คำอธิบายรูปปก (Alt text)" required error={altError} hint={`${[...cover.alt].length}/${LIMITS.alt} · อธิบายภาพเป็นภาษาไทย`}>
          {(p) => (
            <Input {...p} value={cover.alt} disabled={disabled} onChange={(e) => onChange({ ...cover, alt: e.target.value })} />
          )}
        </Field>
      ) : null}
      <MediaPickerDialog
        open={pickerOpen}
        title="เลือกรูปปก"
        onClose={() => setPickerOpen(false)}
        onPick={(m) => {
          setPickerOpen(false);
          fromMedia(m);
        }}
      />
    </div>
  );
}

/* ---------------- categories ---------------- */

export function CategoryPicker({
  categories,
  value,
  disabled,
  error,
  onChange,
}: {
  categories: Category[] | null;
  value: string[];
  disabled?: boolean;
  error?: string;
  onChange: (v: string[]) => void;
}) {
  if (categories === null) {
    return (
      <div className="flex flex-wrap gap-2" aria-hidden="true">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
    );
  }
  if (categories.length === 0) return <p className="adm-hint">โหลดหมวดหมู่ไม่ได้ หรือยังไม่มีหมวดหมู่</p>;
  return (
    <fieldset className="grid gap-2" aria-describedby={error ? "pe-cat-err" : undefined}>
      <legend className="adm-sr-only">หมวดหมู่</legend>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => {
          const on = value.includes(c.slug);
          return (
            <label key={c.slug} className="pe-chip" data-on={on || undefined} data-disabled={disabled || undefined}>
              <input
                type="checkbox"
                className="adm-sr-only"
                checked={on}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked ? [...value, c.slug] : value.filter((s) => s !== c.slug))}
              />
              {on ? <Check size={13} aria-hidden="true" /> : null}
              {c.name_th || c.name}
            </label>
          );
        })}
      </div>
      {error ? (
        <p id="pe-cat-err" className="adm-field-error">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
