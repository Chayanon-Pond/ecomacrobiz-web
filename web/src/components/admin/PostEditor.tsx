"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ApiError } from "@/lib/admin/client";
import { bangkokInputToIso, formatBytes, isoToBangkokInput, SLUG_RE, slugFromTitle } from "@/lib/admin/format";
import type { Category, Cover, Media, Post, PostInput, PostStatus } from "@/lib/admin/types";
import { PageHeader, Spinner } from "./AdminShell";
import { MarkdownEditor } from "./MarkdownEditor";
import { errorMessage, useAdmin } from "./SessionProvider";
import { useToast } from "./Toast";

const MAX_UPLOAD = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];
const EXCERPT_MAX = 200;

type FormState = {
  title: string;
  slug: string;
  excerpt: string;
  body_markdown: string;
  categories: string[];
  author: string;
  status: PostStatus;
  published_at: string; // datetime-local, Asia/Bangkok
  featured: boolean;
  seo_title: string;
  seo_description: string;
  cover: Cover | null;
  cover_media_id: string | null;
};

const EMPTY: FormState = {
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

function fromPost(p: Post): FormState {
  return {
    title: p.title ?? "",
    slug: p.slug ?? "",
    excerpt: p.excerpt ?? "",
    body_markdown: p.body_markdown ?? "",
    categories: (p.categories ?? []).map((c) => c.slug),
    author: p.author ?? "",
    status: p.status === "published" ? "published" : "draft",
    published_at: isoToBangkokInput(p.published_at),
    featured: Boolean(p.featured),
    seo_title: p.seo_title ?? "",
    seo_description: p.seo_description ?? "",
    cover: p.cover ? { ...p.cover, alt: p.cover.alt ?? "" } : null,
    cover_media_id: null,
  };
}

function toInput(f: FormState): PostInput {
  const out: PostInput = {
    slug: f.slug.trim(),
    title: f.title.trim(),
    excerpt: f.excerpt.trim(),
    body_markdown: f.body_markdown,
    cover: f.cover ? { ...f.cover, alt: f.cover.alt.trim() } : null,
    categories: f.categories,
    author: f.author.trim(),
    status: f.status,
    featured: f.featured,
    seo_title: f.seo_title.trim(),
    seo_description: f.seo_description.trim(),
  };
  if (f.cover && f.cover_media_id) out.cover_media_id = f.cover_media_id;
  const iso = bangkokInputToIso(f.published_at);
  if (iso) out.published_at = iso;
  return out;
}

function validate(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = "กรุณากรอกชื่อเรื่อง";
  else if (f.title.trim().length > 200) e.title = "ชื่อเรื่องยาวเกิน 200 ตัวอักษร";
  if (!f.slug.trim()) e.slug = "กรุณากรอก slug";
  else if (!SLUG_RE.test(f.slug.trim())) e.slug = "ใช้ได้เฉพาะ a-z, 0-9 และขีดกลางคั่น เช่น branding-vs-marketing";
  if ([...f.excerpt].length > EXCERPT_MAX) e.excerpt = `บทคัดย่อยาวเกิน ${EXCERPT_MAX} ตัวอักษร`;
  if (!f.body_markdown.trim()) e.body_markdown = "กรุณากรอกเนื้อหาบทความ";
  if (f.cover && !f.cover.alt.trim()) e.cover_alt = "กรุณากรอกคำอธิบายรูปปก (alt text)";
  if (f.published_at && !bangkokInputToIso(f.published_at)) e.published_at = "รูปแบบวันเวลาไม่ถูกต้อง";
  return e;
}

/** API field keys -> our error slots ("cover.alt" -> "cover_alt"). */
function mapServerFields(fields: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    const key = k.replace(/\./g, "_").replace(/\[\d+\]/g, "");
    out[key === "cover_url" || key === "cover_media_id" ? "cover" : key] = v;
  }
  return out;
}

const KNOWN_FIELDS = new Set([
  "title",
  "slug",
  "excerpt",
  "body_markdown",
  "categories",
  "author",
  "status",
  "published_at",
  "featured",
  "seo_title",
  "seo_description",
  "cover",
  "cover_alt",
]);

const FIELD_LABEL: Record<string, string> = {
  title: "ชื่อเรื่อง",
  slug: "Slug",
  excerpt: "บทคัดย่อ",
  body_markdown: "เนื้อหา",
  categories: "หมวดหมู่",
  author: "ผู้เขียน",
  status: "สถานะ",
  published_at: "วันที่เผยแพร่",
  seo_title: "SEO title",
  seo_description: "SEO description",
  cover: "รูปปก",
  cover_alt: "คำอธิบายรูปปก",
};

export function PostEditor({ edit = false }: { edit?: boolean }) {
  const params = useParams<{ id?: string }>();
  const id = edit ? params.id : undefined;
  const { request, user } = useAdmin();
  const toast = useToast();
  const router = useRouter();

  const [form, setForm] = useState<FormState | null>(edit ? null : { ...EMPTY });
  const [saved, setSaved] = useState<string>(edit ? "" : JSON.stringify(EMPTY));
  const [original, setOriginal] = useState<Post | null>(null);
  const [slugTouched, setSlugTouched] = useState(edit);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Default author for new posts.
  const [authorSeeded, setAuthorSeeded] = useState(edit);
  if (!authorSeeded && user && form) {
    setAuthorSeeded(true);
    const seeded = { ...form, author: form.author || user.name || "" };
    setForm(seeded);
    setSaved(JSON.stringify(seeded));
  }

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: Category[] }>("categories", { signal: ctrl.signal })
      .then((r) => setCategories(r.data))
      .catch((err) => {
        if (errorMessage(err)) setCategories([]);
      });
    return () => ctrl.abort();
  }, [request]);

  useEffect(() => {
    if (!edit || !id) return;
    const ctrl = new AbortController();
    request<{ data: Post }>(`posts/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then((r) => {
        const f = fromPost(r.data);
        setOriginal(r.data);
        setForm(f);
        setSaved(JSON.stringify(f));
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setLoadError(err instanceof ApiError && err.status === 404 ? "ไม่พบบทความนี้ (อาจถูกลบไปแล้ว)" : m);
      });
    return () => ctrl.abort();
  }, [edit, id, request]);

  const dirty = form !== null && JSON.stringify(form) !== saved;

  // Unsaved-changes guard: tab close/reload + in-app link clicks.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      if (!window.confirm("มีการแก้ไขที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?")) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  const update = useCallback(<K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
  }, []);

  const uploadMedia = useCallback(
    async (file: File): Promise<Media> => {
      if (!IMAGE_TYPES.includes(file.type)) {
        throw new ApiError(422, "validation_failed", "รองรับเฉพาะไฟล์ JPEG, PNG, WebP, AVIF หรือ GIF");
      }
      if (file.size > MAX_UPLOAD) {
        throw new ApiError(413, "payload_too_large", `ไฟล์ใหญ่เกิน 8 MB (${formatBytes(file.size)})`);
      }
      const fd = new FormData();
      fd.append("file", file);
      const r = await request<{ data: Media }>("media", { method: "POST", form: fd });
      return r.data;
    },
    [request],
  );

  async function onCoverFile(file: File | undefined) {
    if (!file || !form) return;
    setUploading(true);
    try {
      const m = await uploadMedia(file);
      setForm((f) =>
        f
          ? { ...f, cover: { url: m.url, width: m.width, height: m.height, alt: f.cover?.alt ?? "" }, cover_media_id: m.id }
          : f,
      );
      setErrors((e) => ({ ...e, cover: "" }));
      toast("อัปโหลดรูปปกแล้ว — อย่าลืมกรอกคำอธิบายรูป");
    } catch (err) {
      toast(errorMessage(err) || "อัปโหลดไม่สำเร็จ", "error");
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form || saving) return;
    setFormError(null);
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) {
      setFormError("กรุณาแก้ไขช่องที่มีข้อผิดพลาด");
      document.getElementById(`f-${Object.keys(v)[0]}`)?.focus();
      return;
    }
    setSaving(true);
    try {
      const body = toInput(form);
      const r = edit
        ? await request<{ data: Post }>(`posts/${encodeURIComponent(id ?? "")}`, { method: "PUT", json: body })
        : await request<{ data: Post }>("posts", { method: "POST", json: body });
      const next = fromPost(r.data);
      setForm(next);
      setSaved(JSON.stringify(next));
      setOriginal(r.data);
      setErrors({});
      toast(
        r.data.status === "published"
          ? edit
            ? "บันทึกแล้ว — หน้าเว็บไซต์อัปเดตทันที"
            : "สร้างและเผยแพร่บทความแล้ว"
          : "บันทึกฉบับร่างแล้ว",
      );
      if (!edit) router.replace(`/admin/posts/${encodeURIComponent(r.data.id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        const mapped = mapServerFields(err.fields);
        setErrors(mapped);
        const unknown = Object.entries(mapped).filter(([k]) => !KNOWN_FIELDS.has(k));
        setFormError(
          [err.message, ...unknown.map(([k, m]) => `${FIELD_LABEL[k] ?? k}: ${m}`)].filter(Boolean).join(" · "),
        );
        const first = Object.keys(mapped).find((k) => KNOWN_FIELDS.has(k));
        if (first) document.getElementById(`f-${first}`)?.focus();
      } else {
        setFormError(errorMessage(err));
      }
    } finally {
      setSaving(false);
    }
  }

  const slugChangedOnPublished =
    original?.status === "published" && form !== null && form.slug.trim() !== original.slug;

  const title = edit ? "แก้ไขบทความ" : "เขียนบทความใหม่";

  if (loadError) {
    return (
      <>
        <PageHeader title={title} />
        <p className="adm-alert" role="alert">
          {loadError}
        </p>
        <Link href="/admin/posts" className="adm-btn mt-4">
          ← กลับไปหน้ารายการ
        </Link>
      </>
    );
  }
  if (!form) return <Spinner />;

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={title}
        subtitle={edit && original ? `แก้ไขล่าสุด ${new Date(original.updated_at).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` : "Post editor"}
        actions={
          <>
            {original?.status === "published" ? (
              <a href={`/knowledge/${encodeURIComponent(original.slug)}`} target="_blank" rel="noopener" className="adm-btn">
                ดูหน้าจริง ↗
              </a>
            ) : null}
            <Link href="/admin/posts" className="adm-btn">
              ยกเลิก
            </Link>
            <button type="submit" className="adm-btn adm-btn-primary" disabled={saving || uploading}>
              {saving ? "กำลังบันทึก…" : form.status === "published" ? "บันทึกและเผยแพร่" : "บันทึกฉบับร่าง"}
            </button>
          </>
        }
      />

      {dirty ? (
        <p className="adm-hint mb-3" data-warn="true" aria-live="polite">
          มีการแก้ไขที่ยังไม่ได้บันทึก
        </p>
      ) : null}
      {formError ? (
        <p className="adm-alert mb-4" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_18rem]">
        <div className="min-w-0 space-y-5">
          <Field id="f-title" label="ชื่อเรื่อง (Title) *" error={errors.title}>
            {(p) => (
              <input
                {...p}
                className="adm-input text-lg"
                value={form.title}
                maxLength={200}
                onChange={(e) => {
                  const t = e.target.value;
                  update("title", t);
                  if (!slugTouched) {
                    const s = slugFromTitle(t);
                    if (s !== null) update("slug", s);
                  }
                }}
              />
            )}
          </Field>

          <Field
            id="f-slug"
            label="Slug (URL) *"
            error={errors.slug}
            hint={
              <>
                /knowledge/<strong className="text-fg">{form.slug || "…"}</strong> · a-z, 0-9, ขีดกลาง
                {!slugTouched ? " · สร้างจากชื่อเรื่องอัตโนมัติ (เฉพาะภาษาอังกฤษ)" : ""}
              </>
            }
          >
            {(p) => (
              <input
                {...p}
                className="adm-input font-mono"
                value={form.slug}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                onChange={(e) => {
                  setSlugTouched(true);
                  update("slug", e.target.value.toLowerCase().replace(/\s+/g, "-"));
                }}
              />
            )}
          </Field>
          {slugChangedOnPublished ? (
            <p className="adm-alert -mt-3" data-tone="info">
              บทความนี้เผยแพร่แล้ว การเปลี่ยน slug จะทำให้ลิงก์เดิม /knowledge/{original?.slug} ใช้ไม่ได้ (เว้นแต่ API เก็บเป็น legacy slug)
            </p>
          ) : null}

          <Field
            id="f-excerpt"
            label="บทคัดย่อ (Excerpt)"
            error={errors.excerpt}
            hint={<Counter value={form.excerpt} max={EXCERPT_MAX} note="แสดงในหน้ารายการบทความ" />}
          >
            {(p) => (
              <textarea {...p} rows={3} className="adm-input" value={form.excerpt} onChange={(e) => update("excerpt", e.target.value)} />
            )}
          </Field>

          <div>
            <label htmlFor="f-body_markdown" className="adm-label">
              เนื้อหา (Markdown) *
            </label>
            <MarkdownEditor
              id="f-body_markdown"
              value={form.body_markdown}
              onChange={(v) => update("body_markdown", v)}
              onUploadImage={uploadMedia}
              invalid={Boolean(errors.body_markdown)}
              describedBy={errors.body_markdown ? "f-body_markdown-err" : undefined}
            />
            {errors.body_markdown ? (
              <p id="f-body_markdown-err" className="adm-field-error">
                {errors.body_markdown}
              </p>
            ) : null}
          </div>
        </div>

        <aside className="space-y-5">
          <section className="adm-card space-y-4 p-4" aria-labelledby="sec-publish">
            <h2 id="sec-publish" className="font-semibold">
              การเผยแพร่
            </h2>
            <Field id="f-status" label="สถานะ (Status)" error={errors.status}>
              {(p) => (
                <select {...p} className="adm-input" value={form.status} onChange={(e) => update("status", e.target.value as PostStatus)}>
                  <option value="draft">ฉบับร่าง (Draft)</option>
                  <option value="published">เผยแพร่ (Published)</option>
                </select>
              )}
            </Field>
            <Field
              id="f-published_at"
              label="วันเวลาเผยแพร่ (เวลาไทย)"
              error={errors.published_at}
              hint={
                form.status === "published" && !form.published_at
                  ? "เว้นว่าง = ใช้เวลาปัจจุบันตอนบันทึก"
                  : "ตั้งเวลาในอนาคตได้ บทความจะแสดงเมื่อถึงเวลา"
              }
            >
              {(p) => (
                <input
                  {...p}
                  type="datetime-local"
                  className="adm-input"
                  value={form.published_at}
                  onChange={(e) => update("published_at", e.target.value)}
                />
              )}
            </Field>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 cursor-pointer accent-[var(--accent)]"
                checked={form.featured}
                onChange={(e) => update("featured", e.target.checked)}
              />
              บทความแนะนำ (Featured)
            </label>
            <Field id="f-author" label="ผู้เขียน (Author)" error={errors.author}>
              {(p) => <input {...p} className="adm-input" value={form.author} onChange={(e) => update("author", e.target.value)} />}
            </Field>
          </section>

          <fieldset className="adm-card space-y-2 p-4" aria-describedby={errors.categories ? "f-categories-err" : undefined}>
            <legend className="float-left mb-2 w-full font-semibold">หมวดหมู่ (Categories)</legend>
            {categories === null ? (
              <Spinner />
            ) : categories.length === 0 ? (
              <p className="adm-hint">โหลดหมวดหมู่ไม่ได้ หรือยังไม่มีหมวดหมู่</p>
            ) : (
              categories.map((c, i) => (
                <label key={c.slug} className="flex cursor-pointer items-start gap-2 text-sm">
                  <input
                    id={i === 0 ? "f-categories" : undefined}
                    type="checkbox"
                    className="mt-1 size-4 cursor-pointer accent-[var(--accent)]"
                    checked={form.categories.includes(c.slug)}
                    onChange={(e) =>
                      update(
                        "categories",
                        e.target.checked ? [...form.categories, c.slug] : form.categories.filter((s) => s !== c.slug),
                      )
                    }
                  />
                  <span>
                    {c.name_th || c.name}
                    {c.name_th && c.name !== c.name_th ? <span className="text-subtle"> · {c.name}</span> : null}
                  </span>
                </label>
              ))
            )}
            {errors.categories ? (
              <p id="f-categories-err" className="adm-field-error">
                {errors.categories}
              </p>
            ) : null}
          </fieldset>

          <section className="adm-card space-y-3 p-4" aria-labelledby="sec-cover">
            <h2 id="sec-cover" className="font-semibold">
              รูปปก (Cover)
            </h2>
            {form.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.cover.url}
                alt={form.cover.alt || "ตัวอย่างรูปปก"}
                width={form.cover.width || undefined}
                height={form.cover.height || undefined}
                className="aspect-video w-full rounded-lg border border-line object-cover"
              />
            ) : (
              <p className="adm-hint">ยังไม่มีรูปปก (แนะนำ 1600×900 px)</p>
            )}
            <div>
              <label htmlFor="f-cover" className="adm-btn adm-btn-sm cursor-pointer" aria-disabled={uploading || undefined}>
                {uploading ? "กำลังอัปโหลด…" : form.cover ? "เปลี่ยนรูป" : "อัปโหลดรูป"}
              </label>
              <input
                id="f-cover"
                type="file"
                accept={IMAGE_TYPES.join(",")}
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  void onCoverFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              {form.cover ? (
                <button
                  type="button"
                  className="adm-btn adm-btn-sm adm-btn-ghost ml-2"
                  onClick={() => setForm((f) => (f ? { ...f, cover: null, cover_media_id: null } : f))}
                >
                  ลบรูปปก
                </button>
              ) : null}
              {errors.cover ? <p className="adm-field-error">{errors.cover}</p> : null}
            </div>
            {form.cover ? (
              <Field id="f-cover_alt" label="คำอธิบายรูป (Alt text) *" error={errors.cover_alt}>
                {(p) => (
                  <input
                    {...p}
                    className="adm-input"
                    value={form.cover?.alt ?? ""}
                    onChange={(e) => {
                      const alt = e.target.value;
                      setForm((f) => (f && f.cover ? { ...f, cover: { ...f.cover, alt } } : f));
                      setErrors((er) => ({ ...er, cover_alt: "" }));
                    }}
                  />
                )}
              </Field>
            ) : null}
          </section>

          <section className="adm-card space-y-4 p-4" aria-labelledby="sec-seo">
            <h2 id="sec-seo" className="font-semibold">
              SEO
            </h2>
            <Field
              id="f-seo_title"
              label="SEO title"
              error={errors.seo_title}
              hint={<Counter value={form.seo_title} recommended={60} note="Google แสดงประมาณ 50–60 ตัวอักษร · เว้นว่าง = ใช้ชื่อเรื่อง" />}
            >
              {(p) => <input {...p} className="adm-input" value={form.seo_title} onChange={(e) => update("seo_title", e.target.value)} />}
            </Field>
            <Field
              id="f-seo_description"
              label="SEO description"
              error={errors.seo_description}
              hint={<Counter value={form.seo_description} recommended={160} note="แนะนำ 120–160 ตัวอักษร · เว้นว่าง = ใช้บทคัดย่อ" />}
            >
              {(p) => (
                <textarea
                  {...p}
                  rows={3}
                  className="adm-input"
                  value={form.seo_description}
                  onChange={(e) => update("seo_description", e.target.value)}
                />
              )}
            </Field>
          </section>
        </aside>
      </div>
    </form>
  );
}

type FieldProps = {
  id: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: ReactNode;
  children: (p: FieldProps) => ReactNode;
}) {
  const hintId = useId();
  const errId = `${id}-err`;
  const describedBy = [error ? errId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div>
      <label htmlFor={id} className="adm-label">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={errId} className="adm-field-error">
          {error}
        </p>
      ) : null}
      {hint ? (
        <div id={hintId} className="adm-hint mt-1">
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function Counter({ value, max, recommended, note }: { value: string; max?: number; recommended?: number; note?: string }) {
  const n = useMemo(() => [...value].length, [value]);
  const over = max !== undefined && n > max;
  const warn = !over && recommended !== undefined && n > recommended;
  return (
    <span data-over={over || undefined} data-warn={warn || undefined} className="adm-hint">
      {n}
      {max !== undefined ? ` / ${max}` : recommended !== undefined ? ` / ~${recommended}` : ""} ตัวอักษร
      {note ? ` · ${note}` : ""}
    </span>
  );
}
