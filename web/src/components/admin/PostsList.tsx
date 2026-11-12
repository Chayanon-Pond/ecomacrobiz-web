"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { formatDateTime, POST_STATUS_LABEL } from "@/lib/admin/format";
import type { ListResponse, PageMeta, PostSummary } from "@/lib/admin/types";
import { PageHeader, Spinner } from "./AdminShell";
import { ConfirmDialog } from "./Dialog";
import { Pagination, SearchBox, useListParams } from "./ListControls";
import { errorMessage, useAdmin } from "./SessionProvider";
import { useToast } from "./Toast";

const PER_PAGE = 20;
const FILTERS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "published", label: "เผยแพร่แล้ว" },
  { value: "draft", label: "ฉบับร่าง" },
];

export function PostsList() {
  const { request } = useAdmin();
  const toast = useToast();
  const { status, q, page, set } = useListParams("all");
  const [rows, setRows] = useState<PostSummary[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [toDelete, setToDelete] = useState<PostSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    request<ListResponse<PostSummary>>("posts", {
      query: { status, q, page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setRows(r.data);
        setMeta(r.meta);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, status, q, page, reload]);

  const onSearch = useCallback((v: string) => set({ q: v }), [set]);

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await request(`posts/${encodeURIComponent(toDelete.id)}`, { method: "DELETE" });
      toast(`ลบบทความ “${toDelete.title}” แล้ว`);
      setToDelete(null);
      if (rows && rows.length === 1 && page > 1) set({ page: page - 1 });
      else setReload((n) => n + 1);
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="บทความ"
        subtitle="Posts · จัดการบทความในหน้า Knowledge"
        actions={
          <Link href="/admin/posts/new" className="adm-btn adm-btn-primary">
            + เขียนบทความใหม่
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div role="group" aria-label="กรองตามสถานะ" className="adm-tabs">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" aria-pressed={status === f.value} onClick={() => set({ status: f.value })}>
              {f.label}
            </button>
          ))}
        </div>
        <SearchBox value={q} onSearch={onSearch} label="ค้นหาชื่อเรื่องหรือ slug…" />
      </div>

      {error ? (
        <p className="adm-alert mb-4" role="alert">
          {error}{" "}
          <button type="button" className="adm-link" onClick={() => setReload((n) => n + 1)}>
            ลองใหม่
          </button>
        </p>
      ) : null}

      {rows === null && !error ? (
        <Spinner />
      ) : rows ? (
        <div className="adm-table-wrap">
          <table className="adm-table min-w-[48rem]">
            <thead>
              <tr>
                <th scope="col">ชื่อเรื่อง</th>
                <th scope="col">สถานะ</th>
                <th scope="col">หมวดหมู่</th>
                <th scope="col">วันที่เผยแพร่</th>
                <th scope="col">แก้ไขล่าสุด</th>
                <th scope="col" className="text-right">
                  จัดการ
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-muted">
                    ไม่พบบทความ{q ? ` ที่ตรงกับ “${q}”` : ""}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id}>
                    <td className="max-w-[22rem]">
                      <Link href={`/admin/posts/${encodeURIComponent(p.id)}`} className="font-medium hover:underline">
                        {p.title || "(ไม่มีชื่อเรื่อง)"}
                      </Link>
                      <div className="mt-0.5 truncate text-xs text-subtle">/{p.slug}</div>
                      {p.featured ? (
                        <span className="adm-badge mt-1" data-tone="blue">
                          แนะนำ
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <span className="adm-badge" data-tone={p.status === "published" ? "green" : "amber"}>
                        {POST_STATUS_LABEL[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="text-muted">{p.categories.map((c) => c.name_th || c.name).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(p.published_at)}</td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(p.updated_at)}</td>
                    <td>
                      <div className="flex justify-end gap-1.5">
                        <Link href={`/admin/posts/${encodeURIComponent(p.id)}`} className="adm-btn adm-btn-sm">
                          แก้ไข
                        </Link>
                        {p.status === "published" ? (
                          <a
                            href={`/knowledge/${encodeURIComponent(p.slug)}`}
                            target="_blank"
                            rel="noopener"
                            className="adm-btn adm-btn-sm"
                            aria-label={`ดูหน้าจริงของ ${p.title} (เปิดแท็บใหม่)`}
                          >
                            ดูหน้าจริง ↗
                          </a>
                        ) : null}
                        <button type="button" className="adm-btn adm-btn-sm adm-btn-danger" onClick={() => setToDelete(p)}>
                          ลบ
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pagination meta={meta} onPage={(p) => set({ page: p })} />

      <ConfirmDialog
        open={toDelete !== null}
        title="ลบบทความนี้?"
        message={
          <>
            “{toDelete?.title}” จะถูกนำออกจากเว็บไซต์ทันที
            {toDelete?.status === "published" ? " (หน้า /knowledge/" + toDelete.slug + " จะไม่แสดงอีก)" : ""}
          </>
        }
        confirmLabel="ลบบทความ"
        danger
        busy={deleting}
        onConfirm={confirmDelete}
        onClose={() => setToDelete(null)}
      />
    </>
  );
}
