"use client";

import { ExternalLink, FileText, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError } from "@/lib/admin/client";
import { formatBytes, formatDateTime } from "@/lib/admin/format";
import type { Media, MediaDetail } from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import { Alert, Badge, Button, ConfirmDialog, CopyField, Drawer, Field, Skeleton, Textarea, useToast } from "../ui";
import { PostStatusBadge } from "../posts/PostStatusBadge";
import { MEDIA_TYPE_LABEL } from "./upload";

const ALT_MAX = 300;

/** Details drawer of the media page: preview, metadata, alt text, usage, delete. */
export function MediaDetails({
  media,
  onClose,
  onChanged,
}: {
  media: Media | null;
  onClose: () => void;
  /** After an alt edit or delete: refresh the grid. */
  onChanged: () => void;
}) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const canWrite = can("media:write");
  const [detail, setDetail] = useState<MediaDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [alt, setAlt] = useState("");
  const [savingAlt, setSavingAlt] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);

  // Reset when another file is opened.
  if ((media?.id ?? null) !== current) {
    setCurrent(media?.id ?? null);
    setDetail(null);
    setLoadError(null);
    setDeleteError(null);
    setAlt(media?.alt ?? "");
  }

  useEffect(() => {
    if (!media) return;
    const ctrl = new AbortController();
    request<{ data: MediaDetail }>(`media/${encodeURIComponent(media.id)}`, { signal: ctrl.signal })
      .then((r) => {
        setDetail(r.data);
        setAlt(r.data.alt ?? "");
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setLoadError(m);
      });
    return () => ctrl.abort();
  }, [media, request]);

  const view: Media | null = detail ?? media;
  const usage = detail?.usage ?? [];
  const inUse = (detail?.usage.length ?? media?.usage_count ?? 0) > 0;
  const altDirty = view !== null && alt.trim() !== (view.alt ?? "");

  async function saveAlt() {
    if (!view) return;
    setSavingAlt(true);
    try {
      const r = await request<{ data: Media }>(`media/${encodeURIComponent(view.id)}`, {
        method: "PATCH",
        json: { alt: alt.trim() },
      });
      setDetail((d) => (d ? { ...d, ...r.data } : d));
      toast.success("บันทึกคำอธิบายรูปแล้ว");
      onChanged();
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "บันทึกไม่สำเร็จ");
    } finally {
      setSavingAlt(false);
    }
  }

  async function remove() {
    if (!view) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await request(`media/${encodeURIComponent(view.id)}`, { method: "DELETE" });
      toast.success(`ลบ “${view.original_name}” แล้ว`);
      setConfirm(false);
      onChanged();
      onClose();
    } catch (err) {
      setConfirm(false);
      if (err instanceof ApiError && err.status === 409) setDeleteError(err.message || "ไฟล์นี้ถูกใช้งานอยู่ จึงลบไม่ได้");
      else if (!alreadyNotified(err)) setDeleteError(errorMessage(err) || "ลบไม่สำเร็จ");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Drawer
      open={media !== null}
      onClose={onClose}
      title="รายละเอียดไฟล์"
      description={view?.original_name}
      width="36rem"
      footer={
        canWrite && view ? (
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="danger"
              icon={<Trash2 size={15} aria-hidden="true" />}
              onClick={() => setConfirm(true)}
              disabled={inUse || detail === null}
              aria-describedby={inUse ? "md-inuse-note" : undefined}
            >
              ลบไฟล์
            </Button>
            <Button variant="primary" onClick={saveAlt} disabled={!altDirty || [...alt].length > ALT_MAX} loading={savingAlt}>
              บันทึกคำอธิบายรูป
            </Button>
          </div>
        ) : undefined
      }
    >
      {view ? (
        <div className="grid gap-5">
          <a href={view.url} target="_blank" rel="noopener" className="md-detail-preview" aria-label="เปิดไฟล์ต้นฉบับในแท็บใหม่">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={view.url} alt={view.alt || ""} />
          </a>

          <CopyField value={view.url} label="URL ของไฟล์" />

          <dl className="adm-dl">
            <dt>ประเภท</dt>
            <dd>{MEDIA_TYPE_LABEL[view.mime] ?? view.mime}</dd>
            <dt>ขนาดไฟล์</dt>
            <dd>{formatBytes(view.size)}</dd>
            <dt>ขนาดภาพ</dt>
            <dd>{view.width && view.height ? `${view.width} × ${view.height} px` : "—"}</dd>
            <dt>อัปโหลดโดย</dt>
            <dd>{view.uploaded_by ? view.uploaded_by.name || view.uploaded_by.email : "—"}</dd>
            <dt>อัปโหลดเมื่อ</dt>
            <dd>{formatDateTime(view.created_at)}</dd>
          </dl>

          {canWrite ? (
            <Field
              label="คำอธิบายรูป (Alt text)"
              hint={`${[...alt].length}/${ALT_MAX} · อธิบายสิ่งที่อยู่ในภาพเป็นภาษาไทย เพื่อผู้ใช้โปรแกรมอ่านหน้าจอและ SEO`}
              error={[...alt].length > ALT_MAX ? `ยาวเกิน ${ALT_MAX} ตัวอักษร` : null}
            >
              {(p) => <Textarea {...p} rows={3} value={alt} onChange={(e) => setAlt(e.target.value)} />}
            </Field>
          ) : (
            <div>
              <p className="adm-label">คำอธิบายรูป (Alt text)</p>
              <p className="text-sm text-muted">{view.alt || "—"}</p>
            </div>
          )}

          <section aria-labelledby="md-usage-title" className="grid gap-2">
            <h3 id="md-usage-title" className="text-sm font-semibold">
              ใช้งานในบทความ
            </h3>
            {loadError ? (
              <Alert tone="danger">{loadError}</Alert>
            ) : detail === null ? (
              <div className="grid gap-2" aria-hidden="true">
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-9 w-2/3" />
              </div>
            ) : usage.length === 0 ? (
              <p className="text-sm text-muted">ยังไม่ถูกใช้ในบทความใด</p>
            ) : (
              <ul className="md-usage-list">
                {usage.map((u) => (
                  <li key={`${u.post_id}-${u.kind}`}>
                    <FileText size={15} aria-hidden="true" className="shrink-0 text-subtle" />
                    <Link href={`/admin/posts/${encodeURIComponent(u.post_id)}`} className="min-w-0 flex-1 truncate hover:underline">
                      {u.title || u.slug}
                    </Link>
                    <Badge tone="neutral">{u.kind === "cover" ? "รูปปก" : "ในเนื้อหา"}</Badge>
                    <PostStatusBadge status={u.status} />
                    {u.status === "published" ? (
                      <a
                        href={`/knowledge/${encodeURIComponent(u.slug)}`}
                        target="_blank"
                        rel="noopener"
                        className="adm-icon-btn"
                        data-size="sm"
                        aria-label={`เปิดหน้าเว็บของ “${u.title}”`}
                      >
                        <ExternalLink size={14} aria-hidden="true" />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canWrite && inUse ? (
              <p id="md-inuse-note" className="adm-hint">
                ลบไม่ได้ขณะยังถูกใช้งาน — นำรูปออกจากบทความด้านบนก่อน แล้วจึงลบไฟล์
              </p>
            ) : null}
            {deleteError ? <Alert tone="danger">{deleteError}</Alert> : null}
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirm}
        danger
        busy={deleting}
        title="ลบไฟล์นี้ถาวร?"
        message={
          <>
            ไฟล์ <strong className="text-fg">{view?.original_name}</strong> จะถูกลบออกจากคลังสื่อและเซิร์ฟเวอร์ และกู้คืนไม่ได้
          </>
        }
        confirmLabel="ลบไฟล์"
        onConfirm={remove}
        onClose={() => setConfirm(false)}
      />
    </Drawer>
  );
}
