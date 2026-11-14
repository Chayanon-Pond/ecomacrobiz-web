"use client";

import { Eye, EyeOff, FileText, ImageOff, Plus, Search, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { formatDateTime } from "@/lib/admin/format";
import type { BulkPostAction, BulkResult, Category, ListResponse, PageMeta, PostSort, PostSummary } from "@/lib/admin/types";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import {
  Alert,
  Button,
  ButtonLink,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  NoAccess,
  PageHeader,
  Pagination,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
} from "../ui";
import { PostStatusBadge } from "./PostStatusBadge";
import "./posts.css";

const PER_PAGE = 20;
const STATUS_OPTIONS = [
  { value: "all", label: "ทั้งหมด" },
  { value: "draft", label: "ฉบับร่าง" },
  { value: "published", label: "เผยแพร่แล้ว" },
  { value: "scheduled", label: "ตั้งเวลา" },
] as const;
type StatusFilter = (typeof STATUS_OPTIONS)[number]["value"];

const SORTS: { value: PostSort; label: string }[] = [
  { value: "updated_desc", label: "แก้ไขล่าสุด" },
  { value: "updated_asc", label: "แก้ไขเก่าสุด" },
  { value: "published_desc", label: "เผยแพร่ล่าสุด" },
  { value: "published_asc", label: "เผยแพร่เก่าสุด" },
  { value: "title_asc", label: "ชื่อเรื่อง ก–ฮ / A–Z" },
];

const BULK_TEXT: Record<BulkPostAction, { title: string; verb: string; done: string }> = {
  publish: { title: "เผยแพร่บทความที่เลือก?", verb: "เผยแพร่", done: "เผยแพร่แล้ว" },
  unpublish: { title: "ยกเลิกการเผยแพร่บทความที่เลือก?", verb: "ยกเลิกการเผยแพร่", done: "เปลี่ยนเป็นฉบับร่างแล้ว" },
  delete: { title: "ลบบทความที่เลือก?", verb: "ลบ", done: "ลบแล้ว" },
};

function useParamsState() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const statusRaw = sp.get("status") ?? "all";
  const status = (STATUS_OPTIONS.some((o) => o.value === statusRaw) ? statusRaw : "all") as StatusFilter;
  const sortRaw = sp.get("sort") ?? "updated_desc";
  const sort = (SORTS.some((s) => s.value === sortRaw) ? sortRaw : "updated_desc") as PostSort;
  const state = {
    status,
    sort,
    q: sp.get("q") ?? "",
    category: sp.get("category") ?? "",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
  const set = useCallback(
    (patch: Partial<typeof state>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v === "all" || (k === "sort" && v === "updated_desc") || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (!("page" in patch)) next.delete("page");
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return [state, set] as const;
}

export function PostsList() {
  const { request, can } = useAdmin();
  const toast = useToast();
  const [f, set] = useParamsState();
  const [data, setData] = useState<{ key: string; rows: PostSummary[]; meta: PageMeta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [qDraft, setQDraft] = useState(f.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<BulkPostAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulkReport, setBulkReport] = useState<{ action: BulkPostAction; result: BulkResult } | null>(null);
  const searchId = useId();
  const canWrite = can("posts:write");
  const canPublish = can("posts:publish");

  useEffect(() => {
    const ctrl = new AbortController();
    request<{ data: Category[] }>("categories", { signal: ctrl.signal })
      .then((r) => setCategories(r.data ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [request]);

  useEffect(() => {
    if (qDraft.trim() === f.q) return;
    const t = setTimeout(() => set({ q: qDraft.trim() }), 350);
    return () => clearTimeout(t);
  }, [qDraft, f.q, set]);

  const queryKey = JSON.stringify([f.status, f.q, f.category, f.sort, f.page, reload]);
  // Skeleton while the current query is loading; the pager keeps the last meta.
  const rows = data?.key === queryKey ? data.rows : null;
  const meta = data?.meta ?? null;

  useEffect(() => {
    const ctrl = new AbortController();
    request<ListResponse<PostSummary>>("posts", {
      query: {
        status: f.status,
        q: f.q,
        category: f.category,
        sort: f.sort,
        page: f.page,
        per_page: PER_PAGE,
      },
      signal: ctrl.signal,
    })
      .then((r) => {
        setData({ key: queryKey, rows: r.data ?? [], meta: r.meta });
        setError(null);
        setSelected(new Set());
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, queryKey, f.status, f.q, f.category, f.sort, f.page]);

  const titles = useMemo(() => new Map((rows ?? []).map((r) => [r.id, r.title])), [rows]);
  const allChecked = rows !== null && rows.length > 0 && rows.every((r) => selected.has(r.id));
  const filtered = f.q !== "" || f.status !== "all" || f.category !== "";

  function toggle(id: string, on: boolean) {
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(id);
      else n.delete(id);
      return n;
    });
  }

  async function runBulk() {
    if (!bulk) return;
    setBusy(true);
    try {
      const r = await request<{ data: BulkResult }>("posts/bulk", { method: "POST", json: { action: bulk, ids: [...selected] } });
      const result = r.data;
      if (result.failed.length === 0) {
        toast.success(`${BULK_TEXT[bulk].done} ${result.succeeded.length} บทความ`);
        setBulkReport(null);
      } else {
        setBulkReport({ action: bulk, result });
      }
      setBulk(null);
      setReload((n) => n + 1);
    } catch (err) {
      setBulk(null);
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ดำเนินการไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!can("posts:read")) {
    return (
      <>
        <PageHeader title="บทความ" />
        <NoAccess />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="บทความ"
        description="จัดการบทความในหน้า Knowledge"
        actions={
          canWrite ? (
            <ButtonLink href="/admin/posts/new" variant="primary" icon={<Plus size={16} aria-hidden="true" />}>
              เขียนบทความใหม่
            </ButtonLink>
          ) : null
        }
      />

      <div className="pl-filters">
        <SegmentedControl
          label="กรองตามสถานะ"
          value={f.status}
          onChange={(v) => set({ status: v })}
          options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          className="pl-seg"
        />
        <div className="pl-filter-row">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1 sm:max-w-xs">
            <label htmlFor={searchId} className="adm-sr-only">
              ค้นหาบทความ
            </label>
            <Input
              id={searchId}
              type="search"
              inputSize="sm"
              placeholder="ค้นหาชื่อเรื่องหรือเนื้อหา…"
              icon={<Search size={15} aria-hidden="true" />}
              value={qDraft}
              onChange={(e) => setQDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") set({ q: qDraft.trim() });
              }}
            />
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select inputSize="sm" aria-label="หมวดหมู่" value={f.category} onChange={(e) => set({ category: e.target.value })}>
            <option value="">ทุกหมวดหมู่</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name_th || c.name}
              </option>
            ))}
          </Select>
          </div>
          <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select inputSize="sm" aria-label="เรียงลำดับ" value={f.sort} onChange={(e) => set({ sort: e.target.value as PostSort })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
          </div>
        </div>
      </div>

      {bulkReport ? (
        <Alert
          tone="warning"
          className="mb-4"
          title={`${BULK_TEXT[bulkReport.action].done} ${bulkReport.result.succeeded.length} บทความ · ไม่สำเร็จ ${bulkReport.result.failed.length} บทความ`}
          action={
            <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden="true" />} onClick={() => setBulkReport(null)}>
              ปิด
            </Button>
          }
        >
          <ul className="mt-1 grid gap-0.5">
            {bulkReport.result.failed.map((x) => (
              <li key={x.id}>
                <strong className="text-fg">{titles.get(x.id) ?? x.id}</strong>: {x.message}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {canPublish && selected.size > 0 ? (
        <div className="pl-bulk" role="region" aria-label="การดำเนินการกับรายการที่เลือก">
          <span className="text-sm font-medium">เลือก {selected.size} รายการ</span>
          <span className="flex-1" />
          <Button size="sm" icon={<Eye size={14} aria-hidden="true" />} onClick={() => setBulk("publish")}>
            เผยแพร่
          </Button>
          <Button size="sm" icon={<EyeOff size={14} aria-hidden="true" />} onClick={() => setBulk("unpublish")}>
            ยกเลิกเผยแพร่
          </Button>
          <Button size="sm" variant="danger" icon={<Trash2 size={14} aria-hidden="true" />} onClick={() => setBulk("delete")}>
            ลบ
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            ล้าง
          </Button>
        </div>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : rows === null ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <div className="adm-card">
          {filtered ? (
            <EmptyState
              icon={<Search size={22} />}
              title="ไม่พบบทความที่ตรงกับตัวกรอง"
              description="ลองเปลี่ยนคำค้น สถานะ หรือหมวดหมู่"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setQDraft("");
                    set({ q: "", status: "all", category: "" });
                  }}
                >
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<FileText size={22} />}
              title="ยังไม่มีบทความ"
              description="เริ่มเขียนบทความแรกสำหรับหน้า Knowledge"
              action={
                canWrite ? (
                  <ButtonLink href="/admin/posts/new" variant="primary" size="sm" icon={<Plus size={15} aria-hidden="true" />}>
                    เขียนบทความใหม่
                  </ButtonLink>
                ) : null
              }
            />
          )}
        </div>
      ) : (
        <>
          {/* table (md+) */}
          <div className="adm-table-wrap pl-table">
            <table className="adm-table">
              <thead>
                <tr>
                  {canPublish ? (
                    <th className="w-10">
                      <input
                        type="checkbox"
                        className="pl-check"
                        aria-label="เลือกทั้งหมดในหน้านี้"
                        checked={allChecked}
                        onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                      />
                    </th>
                  ) : null}
                  <th>ชื่อเรื่อง</th>
                  <th>สถานะ</th>
                  <th>หมวดหมู่</th>
                  <th>แก้ไขล่าสุด</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} data-selected={selected.has(p.id) || undefined}>
                    {canPublish ? (
                      <td>
                        <input
                          type="checkbox"
                          className="pl-check"
                          aria-label={`เลือก “${p.title}”`}
                          checked={selected.has(p.id)}
                          onChange={(e) => toggle(p.id, e.target.checked)}
                        />
                      </td>
                    ) : null}
                    <td className="min-w-[18rem]">
                      <div className="flex items-center gap-3">
                        <Thumb post={p} />
                        <div className="min-w-0">
                          <Link href={`/admin/posts/${encodeURIComponent(p.id)}`} className="pl-title">
                            {p.title || "(ไม่มีชื่อเรื่อง)"}
                          </Link>
                          <p className="truncate text-xs text-subtle">
                            /knowledge/{p.slug}
                            {p.featured ? (
                              <span className="ml-2 inline-flex items-center gap-1 text-[var(--adm-warning)]">
                                <Star size={11} aria-hidden="true" /> แนะนำ
                              </span>
                            ) : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td>
                      <PostStatusBadge status={p.status} publishedAt={p.published_at} />
                    </td>
                    <td className="text-sm text-muted">{p.categories.map((c) => c.name_th || c.name).join(", ") || "—"}</td>
                    <td className="whitespace-nowrap text-sm text-muted">
                      {formatDateTime(p.updated_at)}
                      {p.created_by ? <span className="block text-xs text-subtle">{p.created_by.name || p.created_by.email}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* cards (< md) */}
          <ul className="pl-cards" aria-label="รายการบทความ">
            {rows.map((p) => (
              <li key={p.id} className="pl-card" data-selected={selected.has(p.id) || undefined}>
                {canPublish ? (
                  <input
                    type="checkbox"
                    className="pl-check"
                    aria-label={`เลือก “${p.title}”`}
                    checked={selected.has(p.id)}
                    onChange={(e) => toggle(p.id, e.target.checked)}
                  />
                ) : null}
                <Thumb post={p} />
                <div className="min-w-0 flex-1">
                  <Link href={`/admin/posts/${encodeURIComponent(p.id)}`} className="pl-title">
                    {p.title || "(ไม่มีชื่อเรื่อง)"}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <PostStatusBadge status={p.status} publishedAt={p.published_at} />
                    <span className="text-xs text-subtle">แก้ไข {formatDateTime(p.updated_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination meta={meta} onPage={(p) => set({ page: p })} label="เปลี่ยนหน้ารายการบทความ" />

      <ConfirmDialog
        open={bulk !== null}
        title={bulk ? BULK_TEXT[bulk].title : ""}
        message={
          bulk === "delete" ? (
            <>บทความ {selected.size} รายการจะถูกลบและนำออกจากเว็บไซต์ (ถ้าเผยแพร่อยู่)</>
          ) : bulk === "unpublish" ? (
            <>บทความ {selected.size} รายการจะถูกนำออกจากเว็บไซต์และกลับเป็นฉบับร่าง</>
          ) : (
            <>บทความ {selected.size} รายการจะแสดงบนเว็บไซต์ทันที</>
          )
        }
        confirmLabel={bulk ? `${BULK_TEXT[bulk].verb} ${selected.size} รายการ` : "ยืนยัน"}
        danger={bulk === "delete"}
        busy={busy}
        onConfirm={runBulk}
        onClose={() => setBulk(null)}
      />
    </>
  );
}

function Thumb({ post }: { post: PostSummary }) {
  return (
    <span className="pl-thumb" aria-hidden="true">
      {post.cover?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={post.cover.url} alt="" loading="lazy" />
      ) : (
        <ImageOff size={16} />
      )}
    </span>
  );
}

function ListSkeleton() {
  return (
    <div className="adm-card grid" role="status" aria-label="กำลังโหลดบทความ">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0" aria-hidden="true">
          <Skeleton className="h-11 w-16 shrink-0 rounded-md" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="hidden h-5 w-20 md:block" />
        </div>
      ))}
    </div>
  );
}
