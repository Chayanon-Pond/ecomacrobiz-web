"use client";

/**
 * Post editor (new + edit). Client-only (loaded with ssr:false by
 * PostEditorLoader). Storage stays Markdown (body_markdown); the block editor
 * and the public-markup preview are lazy chunks of their own.
 *
 * Saving:
 * - drafts autosave (PUT, or POST once for a new post) ~2 s after the last change;
 * - published/scheduled posts never autosave (that would change the live
 *   site): edits are backed up to localStorage and can be restored;
 * - status changes (publish, schedule, unpublish) go through a confirm dialog.
 */
import {
  ArrowLeft,
  CalendarClock,
  Check,
  Eye,
  ExternalLink,
  Loader2,
  PanelRightClose,
  PanelRightOpen,
  PenLine,
  Send,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { ApiError } from "@/lib/admin/client";
import { bangkokInputToIso, formatDateTime, isoToBangkokInput } from "@/lib/admin/format";
import type { Category, Post, PostStatus } from "@/lib/admin/types";
import type { BlockEditorApi } from "../editor/BlockEditor";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import {
  Alert,
  Button,
  ButtonLink,
  ConfirmDialog,
  Drawer,
  ErrorState,
  Field,
  Input,
  SegmentedControl,
  Skeleton,
  Textarea,
  useToast,
} from "../ui";
import {
  canAutosave,
  EMPTY_FORM,
  estimateReadingMinutes,
  FIELD_LABEL,
  formFromPost,
  LIMITS,
  mapServerFields,
  RECOMMENDED,
  toInput,
  validateForm,
  type PostForm,
} from "./post-form";
import { CategoryPicker, CoverPicker, SlugField } from "./PostFields";
import { PostStatusBadge } from "./PostStatusBadge";
import { RetireDialog } from "./RedirectChoice";
import { scoreTone } from "./seo-score";
import { RangeCounter, SeoPanel } from "./SeoPanel";
import { IndexingFields, SocialPanel } from "./SocialPreview";
import { slugify } from "./slug";
import "./posts.css";

const BlockEditor = dynamic(() => import("../editor/BlockEditor"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});
const SeoChecklist = dynamic(() => import("./SeoChecklist"), {
  ssr: false,
  loading: () => (
    <div className="grid gap-2" aria-hidden="true">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  ),
});
const PostPreview = dynamic(() => import("./PostPreview"), {
  ssr: false,
  loading: () => (
    <div className="p-8">
      <Skeleton className="h-10 w-2/3" />
    </div>
  ),
});

const AUTOSAVE_MS = 2000;
const PANEL_FIELDS = new Set([
  "slug",
  "excerpt",
  "categories",
  "author",
  "status",
  "published_at",
  "seo_title",
  "seo_description",
  "cover",
  "cover_alt",
  "featured",
  "focus_keyword",
  "canonical_url",
  "noindex",
  "og_image",
  "og_image_alt",
  "redirect_to",
]);

type SaveKind = "manual" | "auto";
type Backup = { form: PostForm; savedAt: number };

function backupKey(id: string | null) {
  return `adm:post-backup:${id ?? "new"}`;
}
function readBackup(id: string | null): Backup | null {
  try {
    const raw = window.localStorage.getItem(backupKey(id));
    return raw ? (JSON.parse(raw) as Backup) : null;
  } catch {
    return null;
  }
}
function writeBackup(id: string | null, form: PostForm) {
  try {
    window.localStorage.setItem(backupKey(id), JSON.stringify({ form, savedAt: Date.now() } satisfies Backup));
  } catch {
    /* storage full / blocked: backup is best effort */
  }
}
function dropBackup(id: string | null) {
  try {
    window.localStorage.removeItem(backupKey(id));
  } catch {
    /* ignore */
  }
}

const WIDE = "(min-width: 1280px)";
function useWide(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(WIDE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

function timeLabel(ms: number) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(ms);
}

export default function PostEditorPage({ edit }: { edit: boolean }) {
  const params = useParams<{ id?: string }>();
  const { request, can, user } = useAdmin();
  const toast = useToast();
  const router = useRouter();
  const wide = useWide();

  const [postId, setPostId] = useState<string | null>(edit ? (params.id ?? null) : null);
  const [post, setPost] = useState<Post | null>(null);
  const [form, setForm] = useState<PostForm | null>(() => (edit ? null : { ...EMPTY_FORM, author: user.name || "" }));
  const [savedJson, setSavedJson] = useState<string>(() => (edit ? "" : JSON.stringify({ ...EMPTY_FORM, author: user.name || "" })));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveKind | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [autoError, setAutoError] = useState<string | null>(null);
  const [slugAuto, setSlugAuto] = useState(!edit);
  const [view, setView] = useState<"write" | "preview">("write");
  const [panelOpen, setPanelOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [backup, setBackup] = useState<Backup | null>(null);
  const [confirm, setConfirm] = useState<PostStatus | "unpublish" | "delete" | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [now] = useState(() => Date.now());

  const editorApi = useRef<BlockEditorApi | null>(null);
  const formRef = useRef(form);
  const failedJson = useRef<string | null>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    formRef.current = form;
  });

  const canWrite = can("posts:write");
  const canPublish = can("posts:publish");
  const stored: PostStatus = post?.status ?? "draft";
  const readOnly = !canWrite || (!canPublish && stored !== "draft");

  /* ---------------- load ---------------- */

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: Category[] }>("categories", { signal: ctrl.signal })
      .then((r) => setCategories(r.data ?? []))
      .catch((err) => {
        if (errorMessage(err)) setCategories([]);
      });
    return () => ctrl.abort();
  }, [request]);

  useEffect(() => {
    if (!edit || !params.id) {
      const b = readBackup(null);
      if (b && b.form.title.trim() + b.form.body_markdown.trim()) setBackup(b);
      return;
    }
    const ctrl = new AbortController();
    request<{ data: Post }>(`posts/${encodeURIComponent(params.id)}`, { signal: ctrl.signal })
      .then((r) => {
        const f = formFromPost(r.data);
        setPost(r.data);
        setForm(f);
        setSavedJson(JSON.stringify(f));
        setLoadError(null);
        const b = readBackup(r.data.id);
        if (b && JSON.stringify(b.form) !== JSON.stringify(f)) setBackup(b);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setLoadError(err instanceof ApiError && err.status === 404 ? "ไม่พบบทความนี้ (อาจถูกลบไปแล้ว)" : m);
      });
    return () => ctrl.abort();
  }, [edit, params.id, request, reload]);

  const formJson = useMemo(() => (form ? JSON.stringify(form) : ""), [form]);
  const dirty = form !== null && formJson !== savedJson;
  const readingMinutes = useMemo(() => estimateReadingMinutes(form?.body_markdown ?? ""), [form?.body_markdown]);

  const update = useCallback(<K extends keyof PostForm>(key: K, value: PostForm[K]) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => {
      if (!e[key as string]) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
  }, []);

  /* ---------------- save ---------------- */

  const save = useCallback(
    async (kind: SaveKind, redirectTo?: string): Promise<boolean> => {
      const current = formRef.current;
      if (!current) return false;
      const body = editorApi.current?.flush() ?? current.body_markdown;
      const f: PostForm = { ...current, body_markdown: body };
      if (kind === "manual") {
        const v = validateForm(f, Date.now());
        setErrors(v);
        if (Object.keys(v).length) {
          setFormError("กรุณาแก้ไขช่องที่มีข้อผิดพลาด");
          const first = Object.keys(v)[0];
          if (PANEL_FIELDS.has(first)) {
            if (wide) setPanelOpen(true);
            else setSheetOpen(true);
          }
          if (first === "title") titleRef.current?.focus();
          else if (first === "body_markdown") editorApi.current?.focus();
          return false;
        }
        setFormError(null);
      }
      const input = toInput(f);
      if (redirectTo !== undefined) input.redirect_to = redirectTo;
      if (f.status === "published" && stored !== "published") {
        // "Publish now": keep an older past date (re-publish), otherwise now.
        const prevIso = post?.published_at ?? null;
        const prev = prevIso ? Date.parse(prevIso) : NaN;
        input.published_at = prevIso && !Number.isNaN(prev) && prev <= Date.now() ? prevIso : new Date().toISOString();
      }
      setSaving(kind);
      const json = JSON.stringify(f);
      try {
        const r = postId
          ? await request<{ data: Post }>(`posts/${encodeURIComponent(postId)}`, { method: "PUT", json: input })
          : await request<{ data: Post }>("posts", { method: "POST", json: input });
        const saved = r.data;
        const savedForm: PostForm = { ...f, status: saved.status, published_at: isoToBangkokInput(saved.published_at) };
        setPost(saved);
        setSavedJson(JSON.stringify(savedForm));
        setForm((cur) => (cur ? { ...cur, status: saved.status, published_at: savedForm.published_at } : cur));
        setLastSavedAt(Date.now());
        setAutoError(null);
        failedJson.current = null;
        dropBackup(postId);
        if (!postId) {
          dropBackup(null);
          setPostId(saved.id);
          setSlugAuto(false);
          // Keep this component (and the editor's undo history) mounted.
          window.history.replaceState(null, "", `/admin/posts/${encodeURIComponent(saved.id)}`);
        }
        if (kind === "manual") {
          setErrors({});
          const was = post?.status ?? "draft";
          toast.success(
            saved.status === "published"
              ? was === "published"
                ? "อัปเดตแล้ว — หน้าเว็บไซต์แสดงเวอร์ชันใหม่"
                : "เผยแพร่บทความแล้ว"
              : saved.status === "scheduled"
                ? `ตั้งเวลาเผยแพร่ ${formatDateTime(saved.published_at)} แล้ว`
                : was !== "draft"
                  ? "เปลี่ยนเป็นฉบับร่างแล้ว — บทความไม่แสดงบนเว็บไซต์"
                  : "บันทึกฉบับร่างแล้ว",
          );
        }
        return true;
      } catch (err) {
        if (kind === "auto") {
          failedJson.current = json;
          setAutoError(errorMessage(err) || "บันทึกอัตโนมัติไม่สำเร็จ");
          return false;
        }
        if (err instanceof ApiError && err.status === 422) {
          const mapped = mapServerFields(err.fields);
          setErrors(mapped);
          const unknown = Object.entries(mapped).filter(([k]) => !(k in FIELD_LABEL));
          setFormError([err.message, ...unknown.map(([k, m]) => `${k}: ${m}`)].filter(Boolean).join(" · "));
          if (Object.keys(mapped).some((k) => PANEL_FIELDS.has(k))) {
            if (wide) setPanelOpen(true);
            else setSheetOpen(true);
          }
        } else if (err instanceof ApiError && err.status === 409) {
          setErrors((e) => ({ ...e, slug: err.fields.slug ?? err.message }));
          setFormError(err.message);
        } else if (!alreadyNotified(err)) {
          setFormError(errorMessage(err));
        }
        return false;
      } finally {
        setSaving(null);
      }
    },
    [postId, post, stored, request, toast, wide],
  );

  /* ---------------- autosave + local backup ---------------- */

  const autosaveOn = !readOnly && stored === "draft" && form?.status === "draft";
  useEffect(() => {
    if (!autosaveOn || !dirty || saving || !form || !canAutosave(form)) return;
    if (failedJson.current === formJson) return;
    const t = setTimeout(() => void save("auto"), AUTOSAVE_MS);
    return () => clearTimeout(t);
  }, [autosaveOn, dirty, saving, form, formJson, save]);

  useEffect(() => {
    if (!dirty || !form || readOnly) return;
    const t = setTimeout(() => writeBackup(postId, form), 800);
    return () => clearTimeout(t);
  }, [dirty, form, postId, readOnly]);

  /* ---------------- guards & shortcuts ---------------- */

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.getAttribute("href")?.startsWith("#")) return;
      if (!window.confirm("มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการออกจากหน้านี้หรือไม่?")) {
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

  const primaryRef = useRef<() => void>(() => {});
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        primaryRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function deletePost(redirectTo?: string) {
    if (!postId) return;
    setDeleting(true);
    try {
      await request<void>(`posts/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        json: redirectTo !== undefined ? { redirect_to: redirectTo } : undefined,
      });
      dropBackup(postId);
      setSavedJson(formJson);
      setConfirm(null);
      toast.success(
        stored === "published"
          ? redirectTo
            ? `ลบบทความแล้ว — URL เดิมส่งต่อไปที่ ${redirectTo}`
            : "ลบบทความแล้ว — URL เดิมแจ้งว่าถูกลบถาวร (410)"
          : "ลบบทความแล้ว",
      );
      router.replace("/admin/posts");
    } catch (err) {
      setConfirm(null);
      if (err instanceof ApiError && err.status === 422) setFormError([err.message, ...Object.values(err.fields)].join(" · "));
      else if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ลบบทความไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  /* ---------------- primary action ---------------- */

  const target: PostStatus = canPublish ? (form?.status ?? "draft") : "draft";
  const transition: PostStatus | "unpublish" | null =
    target === stored
      ? null
      : target === "draft"
        ? "unpublish"
        : target;

  const primaryLabel =
    target === "draft"
      ? stored === "draft"
        ? "บันทึกฉบับร่าง"
        : "เปลี่ยนเป็นฉบับร่าง"
      : target === "published"
        ? stored === "published"
          ? "อัปเดต"
          : "เผยแพร่"
        : stored === "scheduled"
          ? "อัปเดตกำหนดการ"
          : "ตั้งเวลาเผยแพร่";

  function onPrimary() {
    if (readOnly || saving) return;
    if (transition) {
      const v = form ? validateForm(form, Date.now()) : {};
      if (Object.keys(v).length) {
        void save("manual");
        return;
      }
      setConfirm(transition);
      return;
    }
    void save("manual");
  }
  useEffect(() => {
    primaryRef.current = onPrimary;
  });

  // Title grows with its content (fallback for browsers without field-sizing).
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    let width = -1;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // Re-fit when the column width changes (panel toggle, rotation, fonts).
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w !== width) {
        width = w;
        fit();
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [form?.title, view, wide, panelOpen]);

  function restoreBackup() {
    if (!backup) return;
    setForm(backup.form);
    setEditorKey((k) => k + 1);
    setBackup(null);
    toast.info("กู้คืนเนื้อหาที่ยังไม่ได้บันทึกแล้ว — ตรวจสอบแล้วกดบันทึก");
  }

  /* ---------------- render ---------------- */

  if (loadError) {
    return (
      <div className="grid gap-4">
        <ErrorState message={loadError} onRetry={() => setReload((n) => n + 1)} />
        <div>
          <ButtonLink href="/admin/posts" icon={<ArrowLeft size={15} aria-hidden="true" />}>
            กลับไปหน้ารายการบทความ
          </ButtonLink>
        </div>
      </div>
    );
  }
  if (!form) return <PageSkeleton />;

  const saveState: ReactNode = saving ? (
    <span className="pe-save" data-tone="busy">
      <Loader2 size={14} aria-hidden="true" className="pe-spin" /> กำลังบันทึก…
    </span>
  ) : autoError && dirty ? (
    <span className="pe-save" data-tone="error" title={autoError}>
      <TriangleAlert size={14} aria-hidden="true" /> บันทึกอัตโนมัติไม่สำเร็จ
    </span>
  ) : dirty ? (
    <span className="pe-save" data-tone="dirty">
      <span className="pe-dot" aria-hidden="true" /> มีการเปลี่ยนแปลงที่ยังไม่บันทึก
    </span>
  ) : lastSavedAt ? (
    <span className="pe-save" data-tone="ok">
      <Check size={14} aria-hidden="true" /> บันทึกแล้ว {timeLabel(lastSavedAt)}
    </span>
  ) : post ? (
    <span className="pe-save">แก้ไขล่าสุด {formatDateTime(post.updated_at)}</span>
  ) : null;

  const panel = (
    <SidePanel
      form={form}
      post={post}
      stored={stored}
      canPublish={canPublish}
      readOnly={readOnly}
      errors={errors}
      categories={categories}
      readingMinutes={readingMinutes}
      postId={postId}
      slugAuto={slugAuto}
      now={now}
      update={update}
      setSlugAuto={setSlugAuto}
      setForm={setForm}
      onInsertLink={(href, text) => editorApi.current?.insertLink(href, text)}
      onDelete={postId && canWrite && (stored === "draft" || canPublish) ? () => setConfirm("delete") : undefined}
    />
  );

  const publishedIso = post?.published_at ?? new Date(now).toISOString();

  return (
    <div className="pe-page">
      <h1 className="adm-sr-only">{postId ? "แก้ไขบทความ" : "เขียนบทความใหม่"}</h1>

      <div className="pe-bar">
        <Link href="/admin/posts" className="pe-back" aria-label="กลับไปหน้ารายการบทความ">
          <ArrowLeft size={16} aria-hidden="true" />
          <span className="hidden sm:inline">บทความ</span>
        </Link>
        {post ? <PostStatusBadge status={post.status} publishedAt={post.published_at} /> : null}
        <span className="pe-bar-save" aria-live="polite">
          {saveState}
        </span>
        <span className="flex-1" />
        <SegmentedControl
          label="โหมดแสดงผล"
          value={view}
          onChange={setView}
          options={[
            { value: "write", label: <span className="hidden md:inline">เขียน</span>, icon: <PenLine size={14} aria-hidden="true" />, ariaLabel: "เขียน" },
            { value: "preview", label: <span className="hidden md:inline">ตัวอย่าง</span>, icon: <Eye size={14} aria-hidden="true" />, ariaLabel: "ตัวอย่าง" },
          ]}
        />
        {post?.status === "published" ? (
          <a
            href={`/knowledge/${encodeURIComponent(post.slug)}`}
            target="_blank"
            rel="noopener"
            className="adm-icon-btn hidden sm:inline-grid"
            aria-label="ดูหน้าจริงบนเว็บไซต์ (แท็บใหม่)"
            title="ดูหน้าจริงบนเว็บไซต์"
          >
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        ) : null}
        <button
          type="button"
          className="adm-icon-btn"
          aria-label={wide ? (panelOpen ? "ซ่อนแผงตั้งค่า" : "แสดงแผงตั้งค่า") : "ตั้งค่าบทความ"}
          aria-expanded={wide ? panelOpen : sheetOpen}
          title="ตั้งค่าบทความ"
          onClick={() => {
            if (!wide) return setSheetOpen(true);
            if (view === "preview") {
              setView("write");
              setPanelOpen(true);
            } else setPanelOpen((o) => !o);
          }}
        >
          {wide && panelOpen ? <PanelRightClose size={17} aria-hidden="true" /> : <PanelRightOpen size={17} aria-hidden="true" />}
        </button>
        {!readOnly ? (
          <Button
            variant="primary"
            onClick={onPrimary}
            loading={saving === "manual"}
            loadingText="กำลังบันทึก…"
            icon={target === "scheduled" ? <CalendarClock size={15} aria-hidden="true" /> : target === "published" && stored !== "published" ? <Send size={15} aria-hidden="true" /> : undefined}
            title={`${primaryLabel} (Ctrl/⌘ + S)`}
          >
            {primaryLabel}
          </Button>
        ) : null}
      </div>

      <div className="grid gap-3">
        {backup ? (
          <Alert
            tone="warning"
            title="พบเนื้อหาที่ยังไม่ได้บันทึกจากเครื่องนี้"
            action={
              <div className="flex gap-2">
                <Button size="sm" onClick={restoreBackup}>
                  กู้คืน
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    dropBackup(postId);
                    setBackup(null);
                  }}
                >
                  ทิ้ง
                </Button>
              </div>
            }
          >
            บันทึกไว้เมื่อ {formatDateTime(new Date(backup.savedAt).toISOString())}
          </Alert>
        ) : null}
        {!canWrite ? (
          <Alert tone="info">บัญชีของคุณดูบทความได้อย่างเดียว</Alert>
        ) : readOnly ? (
          <Alert tone="info">บทความนี้{stored === "scheduled" ? "ตั้งเวลาเผยแพร่ไว้แล้ว" : "เผยแพร่แล้ว"} — ต้องมีสิทธิ์เผยแพร่ (posts:publish) จึงจะแก้ไขได้</Alert>
        ) : !autosaveOn && dirty ? (
          <Alert tone="info">
            บทความที่{stored === "draft" ? "กำลังจะเปลี่ยนสถานะ" : stored === "scheduled" ? "ตั้งเวลาไว้" : "เผยแพร่แล้ว"}จะไม่บันทึกอัตโนมัติ เพื่อไม่ให้หน้าเว็บเปลี่ยนก่อนคุณกด “{primaryLabel}” — เราสำรองไว้ในเครื่องนี้ให้แล้ว
          </Alert>
        ) : null}
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
      </div>

      {/* Preview gets the full width so the article layout matches the site. */}
      <div className="pe-body" data-panel={wide && panelOpen && view === "write" ? "open" : undefined}>
        <div className="min-w-0">
          <div hidden={view !== "write"} className="pe-write">
            <label htmlFor="pe-title" className="adm-sr-only">
              ชื่อเรื่อง
            </label>
            <textarea
              id="pe-title"
              ref={titleRef}
              className="pe-title"
              rows={1}
              placeholder="ชื่อเรื่องบทความ"
              value={form.title}
              maxLength={LIMITS.title}
              readOnly={readOnly}
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? "pe-title-err" : undefined}
              onChange={(e) => {
                const t = e.target.value.replace(/[\r\n]+/g, " ");
                update("title", t);
                if (slugAuto && !postId) {
                  const s = slugify(t);
                  update("slug", s);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  editorApi.current?.focus();
                }
              }}
            />
            {errors.title ? (
              <p id="pe-title-err" className="adm-field-error">
                {errors.title}
              </p>
            ) : null}
            <BlockEditor
              key={editorKey}
              id="pe-body"
              initialMarkdown={form.body_markdown}
              editable={!readOnly}
              invalid={Boolean(errors.body_markdown)}
              describedBy={errors.body_markdown ? "pe-body-err" : undefined}
              onChange={(md) => update("body_markdown", md)}
              onReady={(api) => {
                editorApi.current = api;
              }}
            />
            {errors.body_markdown ? (
              <p id="pe-body-err" className="adm-field-error">
                {errors.body_markdown}
              </p>
            ) : null}
          </div>
          {view === "preview" ? (
            <div className="pe-preview" role="region" aria-label="ตัวอย่างหน้าบทความบนเว็บไซต์">
              <p className="pe-preview-note">
                <Eye size={14} aria-hidden="true" /> ตัวอย่างนี้ใช้คอมโพเนนต์และสไตล์เดียวกับหน้าเว็บไซต์จริง
              </p>
              <PostPreview
                form={form}
                categories={categories ?? []}
                readingMinutes={readingMinutes}
                publishedAt={target === "scheduled" ? (bangkokInputToIso(form.published_at) ?? publishedIso) : publishedIso}
                updatedAt={post?.updated_at ?? publishedIso}
              />
            </div>
          ) : null}
        </div>
        {wide && panelOpen && view === "write" ? (
          <aside className="pe-panel" aria-label="ตั้งค่าบทความ">
            {panel}
          </aside>
        ) : null}
      </div>

      {!wide ? (
        <Drawer open={sheetOpen} onClose={() => setSheetOpen(false)} title="ตั้งค่าบทความ" width="28rem">
          {panel}
        </Drawer>
      ) : null}

      <RetireDialog
        open={(confirm === "unpublish" || confirm === "delete") && stored === "published"}
        action={confirm === "delete" ? "delete" : "unpublish"}
        slug={post?.slug ?? form.slug}
        postId={postId}
        busy={saving === "manual" || deleting}
        onClose={() => setConfirm(null)}
        onConfirm={async (redirectTo) => {
          if (confirm === "delete") {
            await deletePost(redirectTo);
            return;
          }
          await save("manual", redirectTo);
          setConfirm(null);
        }}
      />

      <ConfirmDialog
        open={confirm === "delete" && stored !== "published"}
        title="ลบบทความนี้?"
        message={stored === "scheduled" ? "บทความที่ตั้งเวลาไว้จะถูกลบและจะไม่เผยแพร่" : "ฉบับร่างนี้จะถูกลบ"}
        confirmLabel="ลบบทความ"
        danger
        busy={deleting}
        onClose={() => setConfirm(null)}
        onConfirm={() => void deletePost()}
      />

      <ConfirmDialog
        open={confirm !== null && confirm !== "delete" && !(confirm === "unpublish" && stored === "published")}
        title={
          confirm === "published"
            ? "เผยแพร่บทความนี้?"
            : confirm === "scheduled"
              ? "ตั้งเวลาเผยแพร่?"
              : "เปลี่ยนเป็นฉบับร่าง?"
        }
        message={
          confirm === "published"
            ? "บทความจะแสดงบนเว็บไซต์ทันทีที่ /knowledge/" + form.slug
            : confirm === "scheduled"
              ? `บทความจะเผยแพร่อัตโนมัติเมื่อ ${formatDateTime(bangkokInputToIso(form.published_at))} (เวลาไทย)`
              : "บทความจะถูกนำออกจากเว็บไซต์ทันที และกลับมาบันทึกอัตโนมัติแบบฉบับร่าง"
        }
        confirmLabel={confirm === "published" ? "เผยแพร่เลย" : confirm === "scheduled" ? "ตั้งเวลา" : "เปลี่ยนเป็นฉบับร่าง"}
        danger={confirm === "unpublish"}
        busy={saving === "manual"}
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          await save("manual");
          setConfirm(null);
        }}
      />
    </div>
  );
}

/* ---------------- side panel ---------------- */

function Section({ title, children, defaultOpen = true }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="pe-sec" open={defaultOpen}>
      <summary>{title}</summary>
      <div className="pe-sec-body">{children}</div>
    </details>
  );
}

function SidePanel({
  form,
  post,
  stored,
  canPublish,
  readOnly,
  errors,
  categories,
  readingMinutes,
  postId,
  slugAuto,
  now,
  update,
  setSlugAuto,
  setForm,
  onInsertLink,
  onDelete,
}: {
  form: PostForm;
  post: Post | null;
  stored: PostStatus;
  canPublish: boolean;
  readOnly: boolean;
  errors: Record<string, string>;
  categories: Category[] | null;
  readingMinutes: number;
  postId: string | null;
  slugAuto: boolean;
  now: number;
  update: <K extends keyof PostForm>(key: K, value: PostForm[K]) => void;
  setSlugAuto: (v: boolean) => void;
  setForm: React.Dispatch<React.SetStateAction<PostForm | null>>;
  onInsertLink: (href: string, text: string) => void;
  onDelete?: () => void;
}) {
  const [score, setScore] = useState<number | null>(null);
  const seoInput = useMemo(
    () => ({
      title: form.title,
      seoTitle: form.seo_title,
      seoDescription: form.seo_description,
      excerpt: form.excerpt,
      slug: form.slug,
      focusKeyword: form.focus_keyword,
      cover: form.cover,
      noindex: form.noindex,
      canonicalUrl: form.canonical_url,
    }),
    [form.title, form.seo_title, form.seo_description, form.excerpt, form.slug, form.focus_keyword, form.cover, form.noindex, form.canonical_url],
  );
  const minLocal = isoToBangkokInput(new Date(now + 5 * 60_000).toISOString());
  return (
    <div className="pe-panel-inner">
      <Section title="สถานะและการเผยแพร่">
        {canPublish ? (
          <div className="grid gap-3">
            <div role="radiogroup" aria-label="สถานะเมื่อบันทึก" className="pe-status">
              {(
                [
                  ["draft", "ฉบับร่าง", "ยังไม่แสดงบนเว็บไซต์ · บันทึกอัตโนมัติ"],
                  ["published", stored === "published" ? "เผยแพร่อยู่" : "เผยแพร่ทันที", "แสดงบนเว็บไซต์"],
                  ["scheduled", "ตั้งเวลาเผยแพร่", "เผยแพร่อัตโนมัติตามเวลาที่กำหนด"],
                ] as [PostStatus, string, string][]
              ).map(([value, label, hint]) => (
                <label key={value} className="pe-status-opt" data-on={form.status === value || undefined}>
                  <input
                    type="radio"
                    name="pe-status"
                    value={value}
                    checked={form.status === value}
                    disabled={readOnly}
                    onChange={() => {
                      update("status", value);
                      if (value === "scheduled" && (!form.published_at || Date.parse(bangkokInputToIso(form.published_at) ?? "") <= Date.now())) {
                        update("published_at", "");
                      }
                    }}
                  />
                  <span>
                    <span className="block text-sm font-medium">{label}</span>
                    <span className="block text-xs text-muted">{hint}</span>
                  </span>
                </label>
              ))}
            </div>
            {form.status === "scheduled" ? (
              <Field label="วันและเวลาเผยแพร่ (เวลาไทย)" required error={errors.published_at}>
                {(p) => (
                  <Input
                    {...p}
                    type="datetime-local"
                    min={minLocal}
                    value={form.published_at}
                    disabled={readOnly}
                    onChange={(e) => update("published_at", e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            {form.status === "published" && stored === "published" ? (
              <Field label="วันที่เผยแพร่ (เวลาไทย)" error={errors.published_at} hint="แสดงเป็นวันที่ของบทความบนเว็บไซต์">
                {(p) => (
                  <Input
                    {...p}
                    type="datetime-local"
                    value={form.published_at}
                    disabled={readOnly}
                    onChange={(e) => update("published_at", e.target.value)}
                  />
                )}
              </Field>
            ) : null}
            {stored === "scheduled" && post?.published_at ? (
              <p className="pe-note">
                <CalendarClock size={14} aria-hidden="true" /> ตั้งเวลาไว้: {formatDateTime(post.published_at)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-2 text-sm">
            <p>
              สถานะ: <PostStatusBadge status={stored} publishedAt={post?.published_at} />
            </p>
            <p className="adm-hint">บัญชีของคุณบันทึกได้เฉพาะฉบับร่าง ผู้ที่มีสิทธิ์เผยแพร่จะเป็นผู้เผยแพร่บทความ</p>
          </div>
        )}
      </Section>

      <Section title="URL">
        <SlugField
          value={form.slug}
          title={form.title}
          postId={postId}
          auto={slugAuto && !postId}
          error={errors.slug}
          disabled={readOnly}
          publishedSlug={post?.status === "published" ? post.slug : null}
          onChange={(s) => update("slug", s)}
          onAutoChange={setSlugAuto}
        />
      </Section>

      <Section title="รูปปก">
        <CoverPicker
          cover={form.cover}
          error={errors.cover}
          altError={errors.cover_alt}
          disabled={readOnly}
          onChange={(cover, mediaId) =>
            setForm((f) => (f ? { ...f, cover, cover_media_id: mediaId === undefined ? f.cover_media_id : mediaId } : f))
          }
        />
      </Section>

      <Section title="หมวดหมู่">
        <CategoryPicker
          categories={categories}
          value={form.categories}
          disabled={readOnly}
          error={errors.categories}
          onChange={(v) => update("categories", v)}
        />
      </Section>

      <Section title="บทคัดย่อ">
        <Field
          label="บทคัดย่อ (Excerpt)"
          labelHidden
          error={errors.excerpt}
          hint={
            <>
              <RangeCounter value={form.excerpt} range={RECOMMENDED.excerpt} max={LIMITS.excerpt} /> · แสดงใต้ชื่อเรื่องและในการ์ดบทความ
            </>
          }
        >
          {(p) => <Textarea {...p} rows={4} value={form.excerpt} disabled={readOnly} onChange={(e) => update("excerpt", e.target.value)} />}
        </Field>
      </Section>

      <Section
        title={
          <span className="flex items-center gap-2">
            คะแนน SEO
            {score !== null ? (
              <span className="seo-pill" data-tone={scoreTone(score)} aria-label={`${score} จาก 100`}>
                {score}
              </span>
            ) : null}
          </span>
        }
      >
        <SeoChecklist
          input={seoInput}
          body={form.body_markdown}
          postId={postId}
          disabled={readOnly}
          keywordError={errors.focus_keyword}
          onKeywordChange={(v) => update("focus_keyword", v)}
          onInsertLink={readOnly ? undefined : onInsertLink}
          onScore={setScore}
        />
      </Section>

      <Section title="SEO และตัวอย่างบน Google" defaultOpen={false}>
        <SeoPanel
          title={form.title}
          seoTitle={form.seo_title}
          seoDescription={form.seo_description}
          excerpt={form.excerpt}
          slug={form.slug}
          errors={errors}
          disabled={readOnly}
          onChange={(k, v) => update(k, v)}
        />
      </Section>

      <Section title="แชร์บนโซเชียล" defaultOpen={false}>
        <SocialPanel
          title={form.seo_title.trim() || form.title}
          description={form.seo_description.trim() || form.excerpt}
          slug={form.slug}
          cover={form.cover}
          ogImage={form.og_image}
          errors={errors}
          disabled={readOnly}
          onOgChange={(og, mediaId) =>
            setForm((f) => (f ? { ...f, og_image: og, og_media_id: mediaId === undefined ? f.og_media_id : mediaId } : f))
          }
        />
      </Section>

      <Section title="การแสดงผลบน Google (ขั้นสูง)" defaultOpen={Boolean(form.noindex || form.canonical_url || errors.canonical_url)}>
        <IndexingFields
          canonical={form.canonical_url}
          noindex={form.noindex}
          slug={form.slug}
          errors={errors}
          disabled={readOnly}
          onCanonical={(v) => update("canonical_url", v)}
          onNoindex={(v) => update("noindex", v)}
        />
      </Section>

      <Section title="อื่น ๆ" defaultOpen={false}>
        <div className="grid gap-4">
          <Field label="ผู้เขียน" error={errors.author}>
            {(p) => <Input {...p} value={form.author} maxLength={LIMITS.author} disabled={readOnly} onChange={(e) => update("author", e.target.value)} />}
          </Field>
          <label className="adm-check cursor-pointer">
            <input type="checkbox" checked={form.featured} disabled={readOnly} onChange={(e) => update("featured", e.target.checked)} />
            บทความแนะนำ (Featured)
          </label>
          <div>
            <p className="adm-label">เวลาอ่านโดยประมาณ</p>
            <p className="text-sm">
              ≈ {readingMinutes} นาที <span className="text-muted">· คำนวณอัตโนมัติจากเนื้อหา</span>
            </p>
          </div>
          {post?.created_by ? (
            <p className="adm-hint">
              สร้างโดย {post.created_by.name || post.created_by.email} · แก้ไขล่าสุด {formatDateTime(post.updated_at)}
            </p>
          ) : null}
          {onDelete ? (
            <div className="border-t border-line pt-4">
              <Button variant="danger" size="sm" icon={<Trash2 size={14} aria-hidden="true" />} onClick={onDelete}>
                ลบบทความ
              </Button>
              {stored === "published" ? (
                <p className="adm-hint mt-1.5">เลือกได้ว่าจะส่งผู้เข้าชม URL เดิมไปที่ใด ก่อนยืนยันการลบ</p>
              ) : null}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="ed-shell ed-loading grid content-start gap-4 p-8" aria-busy="true" aria-label="กำลังโหลดตัวแก้ไข">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="mt-4 h-6 w-1/2" />
      <Skeleton className="h-4 w-full" />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="grid gap-5" role="status" aria-label="กำลังโหลดบทความ">
      <Skeleton className="h-10 w-full" />
      <div className="pe-body" data-panel="open">
        <div className="grid content-start gap-4">
          <Skeleton className="h-12 w-3/4" />
          <EditorSkeleton />
        </div>
        <div className="hidden gap-3 xl:grid">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
