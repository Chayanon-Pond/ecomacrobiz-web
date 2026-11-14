"use client";

import { ImageOff, ImagePlus, Search, UploadCloud, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState, type DragEvent } from "react";
import { formatBytes } from "@/lib/admin/format";
import type { ListResponse, Media, PageMeta } from "@/lib/admin/types";
import { useAdmin, errorMessage } from "../SessionProvider";
import { Badge, Button, EmptyState, ErrorState, Input, Pagination, Select, Skeleton } from "../ui";
import { IMAGE_ACCEPT, MEDIA_TYPE_LABEL } from "./upload";
import { useUploadQueue, type UploadItem } from "./useUploadQueue";
import "./media.css";

const PER_PAGE = 24;
const TYPES = ["all", "image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"];

type Filters = { q: string; type: string; page: number };

/** Filters live in the URL on the media page, in local state inside the picker. */
function useFilters(syncUrl: boolean): [Filters, (p: Partial<Filters>) => void] {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [local, setLocal] = useState<Filters>({ q: "", type: "all", page: 1 });
  const fromUrl: Filters = {
    q: sp.get("q") ?? "",
    type: sp.get("type") ?? "all",
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
  const set = useCallback(
    (p: Partial<Filters>) => {
      const reset = p.q !== undefined || p.type !== undefined;
      if (!syncUrl) {
        setLocal((f) => ({ ...f, ...p, page: reset ? 1 : (p.page ?? f.page) }));
        return;
      }
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(p)) {
        if (v === "" || v === "all" || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (reset) next.delete("page");
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [syncUrl, sp, router, pathname],
  );
  return [syncUrl ? fromUrl : local, set];
}

export function MediaLibrary({
  mode,
  selectedId,
  onSelect,
  onOpen,
  reloadKey = 0,
}: {
  mode: "page" | "picker";
  selectedId?: string | null;
  /** picker: single click selects, double click / Enter on the card confirms via onOpen. */
  onSelect?: (m: Media) => void;
  /** page: open the details drawer. picker: confirm the pick. */
  onOpen: (m: Media) => void;
  /** Bump to refetch (e.g. after an edit in the details drawer). */
  reloadKey?: number;
}) {
  const { request, can } = useAdmin();
  const canWrite = can("media:write");
  const [filters, setFilters] = useFilters(mode === "page");
  const [rows, setRows] = useState<Media[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [qDraft, setQDraft] = useState(filters.q);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchId = useId();
  const typeId = useId();

  const onUploaded = useCallback(
    (m: Media) => {
      setReload((n) => n + 1);
      if (mode === "picker") onSelect?.(m);
    },
    [mode, onSelect],
  );
  const queue = useUploadQueue(onUploaded);

  // Debounced search.
  useEffect(() => {
    if (qDraft.trim() === filters.q) return;
    const t = setTimeout(() => setFilters({ q: qDraft.trim() }), 350);
    return () => clearTimeout(t);
  }, [qDraft, filters.q, setFilters]);

  useEffect(() => {
    const ctrl = new AbortController();
    request<ListResponse<Media>>("media", {
      query: { q: filters.q, type: filters.type === "all" ? undefined : filters.type, page: filters.page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setRows(r.data ?? []);
        setMeta(r.meta);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, filters.q, filters.type, filters.page, reload, reloadKey]);

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    if (!canWrite) return;
    if (e.dataTransfer.files?.length) queue.add(e.dataTransfer.files);
  }

  const filtered = filters.q !== "" || filters.type !== "all";

  return (
    <div
      className="md-lib"
      data-mode={mode}
      data-drag={dragOver || undefined}
      onDragOver={(e) => {
        if (!canWrite || !Array.from(e.dataTransfer.types).includes("Files")) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragOver(false);
      }}
      onDrop={onDrop}
    >
      <div className="md-toolbar">
        <div className="min-w-0 flex-1 sm:max-w-xs">
          <label htmlFor={searchId} className="adm-sr-only">
            ค้นหาไฟล์
          </label>
          <Input
            id={searchId}
            type="search"
            inputSize="sm"
            placeholder="ค้นหาชื่อไฟล์หรือคำอธิบายรูป…"
            icon={<Search size={15} aria-hidden="true" />}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setFilters({ q: qDraft.trim() });
              }
            }}
          />
        </div>
        <div>
          <label htmlFor={typeId} className="adm-sr-only">
            ประเภทไฟล์
          </label>
          <Select id={typeId} inputSize="sm" value={filters.type} onChange={(e) => setFilters({ type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t === "all" ? "ทุกประเภท" : MEDIA_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </div>
        {canWrite ? (
          <>
            <Button
              size="sm"
              variant={mode === "page" ? "primary" : "secondary"}
              icon={<UploadCloud size={15} aria-hidden="true" />}
              onClick={() => fileInput.current?.click()}
              className="ml-auto"
            >
              อัปโหลด
            </Button>
            <input
              ref={fileInput}
              type="file"
              multiple={mode === "page"}
              accept={IMAGE_ACCEPT}
              className="adm-sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                if (e.target.files?.length) queue.add(e.target.files);
                e.target.value = "";
              }}
            />
          </>
        ) : null}
      </div>

      {queue.items.length > 0 ? <UploadList items={queue.items} onClear={queue.clearFinished} busy={queue.busy} /> : null}

      {error ? (
        <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : rows === null ? (
        <div className="md-grid" role="status" aria-label="กำลังโหลดคลังสื่อ">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="md-card" aria-hidden="true">
              <Skeleton className="md-thumb" />
              <div className="grid gap-1.5 p-2.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        filtered ? (
          <EmptyState
            icon={<Search size={22} />}
            title="ไม่พบไฟล์ที่ตรงกับการค้นหา"
            description="ลองเปลี่ยนคำค้นหรือประเภทไฟล์"
            action={
              <Button
                size="sm"
                onClick={() => {
                  setQDraft("");
                  setFilters({ q: "", type: "all" });
                }}
              >
                ล้างตัวกรอง
              </Button>
            }
          />
        ) : (
          <button
            type="button"
            className="md-dropzone"
            disabled={!canWrite}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={28} aria-hidden="true" />
            <span className="font-medium text-fg">ยังไม่มีไฟล์ในคลังสื่อ</span>
            <span className="text-sm text-muted">
              {canWrite ? "ลากไฟล์มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์ (JPEG, PNG, WebP, AVIF, GIF · สูงสุด 8 MB)" : "ยังไม่มีผู้อัปโหลดไฟล์"}
            </span>
          </button>
        )
      ) : (
        <ul className="md-grid" aria-label="ไฟล์ในคลังสื่อ">
          {rows.map((m) => (
            <li key={m.id}>
              <MediaCard
                media={m}
                selected={mode === "picker" && selectedId === m.id}
                pressable={mode === "picker"}
                onClick={() => (mode === "picker" ? onSelect?.(m) : onOpen(m))}
                onDoubleClick={() => mode === "picker" && onOpen(m)}
              />
            </li>
          ))}
        </ul>
      )}

      <Pagination meta={meta} onPage={(p) => setFilters({ page: p })} label="เปลี่ยนหน้าคลังสื่อ" />

      {dragOver ? (
        <div className="md-drop-overlay" aria-hidden="true">
          <UploadCloud size={32} />
          <span>วางไฟล์เพื่ออัปโหลด</span>
        </div>
      ) : null}
    </div>
  );
}

function MediaCard({
  media,
  selected,
  pressable,
  onClick,
  onDoubleClick,
}: {
  media: Media;
  selected: boolean;
  pressable: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      className="md-card"
      aria-pressed={pressable ? selected : undefined}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={media.original_name}
    >
      <span className="md-thumb">
        {broken ? (
          <ImageOff size={22} aria-hidden="true" className="text-subtle" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={media.url} alt={media.alt || ""} loading="lazy" decoding="async" onError={() => setBroken(true)} />
        )}
        {media.usage_count > 0 ? (
          <Badge tone="info" className="md-usage">
            ใช้ใน {media.usage_count}
          </Badge>
        ) : null}
        {!media.alt ? (
          <Badge tone="warning" className="md-noalt" title="ยังไม่มีคำอธิบายรูป (alt)">
            ไม่มี alt
          </Badge>
        ) : null}
      </span>
      <span className="md-meta">
        <span className="md-name">{media.original_name || media.url.split("/").pop()}</span>
        <span className="md-sub">
          {MEDIA_TYPE_LABEL[media.mime] ?? media.mime} · {media.width && media.height ? `${media.width}×${media.height} · ` : ""}
          {formatBytes(media.size)}
        </span>
      </span>
    </button>
  );
}

function UploadList({ items, onClear, busy }: { items: UploadItem[]; onClear: () => void; busy: boolean }) {
  const done = items.filter((x) => x.status === "done").length;
  const failed = items.filter((x) => x.status === "error").length;
  return (
    <section className="md-uploads" aria-label="สถานะการอัปโหลด">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm" aria-live="polite">
          {busy ? `กำลังอัปโหลด… (${done}/${items.length})` : `อัปโหลดเสร็จ ${done} ไฟล์${failed ? ` · ไม่สำเร็จ ${failed} ไฟล์` : ""}`}
        </p>
        {!busy ? (
          <Button size="sm" variant="ghost" icon={<X size={14} aria-hidden="true" />} onClick={onClear}>
            ซ่อน
          </Button>
        ) : null}
      </div>
      <ul className="grid gap-2">
        {items.map((x) => (
          <li key={x.id} className="md-upload" data-status={x.status}>
            <span className="md-upload-thumb" aria-hidden="true">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {x.previewUrl ? <img src={x.previewUrl} alt="" /> : <ImageOff size={16} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{x.name}</span>
              {x.status === "error" ? (
                <span className="block text-xs text-[var(--adm-danger)]">{x.error}</span>
              ) : (
                <span
                  className="md-progress"
                  role="progressbar"
                  aria-label={`อัปโหลด ${x.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(x.progress * 100)}
                >
                  <span style={{ width: `${Math.round(x.progress * 100)}%` }} />
                </span>
              )}
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted">
              {x.status === "done" ? "เสร็จแล้ว" : x.status === "error" ? "ล้มเหลว" : x.status === "queued" ? "รอคิว" : `${Math.round(x.progress * 100)}%`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
