"use client";

/**
 * /admin/redirects — 301 redirects and 410 (gone) URLs of the public site.
 * View: posts:read. Create / edit / delete: posts:publish (API enforces).
 * Rows of kind "auto" are created by the API when a published post is
 * unpublished or deleted.
 */
import { ArrowRight, ExternalLink, FileSearch, Pencil, Plus, Search, Shuffle, Trash2 } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { ApiError } from "@/lib/admin/client";
import { formatDateTime } from "@/lib/admin/format";
import type { ListResponse, PageMeta, Redirect, RedirectInput, RedirectStatus } from "@/lib/admin/types";
import { PostSearch } from "../posts/RedirectChoice";
import { alreadyNotified, errorMessage, useAdmin } from "../SessionProvider";
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  Input,
  NoAccess,
  PageHeader,
  Pagination,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from "../ui";
import { fromPathError, normalizeSitePath, toTargetError } from "./redirect-path";
import "./redirects.css";

const PER_PAGE = 25;
type KindFilter = "all" | "manual" | "auto";
type StatusFilter = "all" | "301" | "410";

function useFilters() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const kindRaw = sp.get("kind");
  const statusRaw = sp.get("status");
  const state = {
    q: sp.get("q") ?? "",
    kind: (kindRaw === "manual" || kindRaw === "auto" ? kindRaw : "all") as KindFilter,
    status: (statusRaw === "301" || statusRaw === "410" ? statusRaw : "all") as StatusFilter,
    page: Math.max(1, Number(sp.get("page")) || 1),
  };
  const set = useCallback(
    (patch: Partial<typeof state>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === "" || v === "all" || (k === "page" && v === 1)) next.delete(k);
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

export function RedirectsPage() {
  const { request, can } = useAdmin();
  const toast = useToast();
  const [f, set] = useFilters();
  const [qDraft, setQDraft] = useState(f.q);
  const [data, setData] = useState<{ key: string; rows: Redirect[]; meta: PageMeta } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Redirect | "new" | null>(null);
  const [deleting, setDeleting] = useState<Redirect | null>(null);
  const [busy, setBusy] = useState(false);
  const searchId = useId();
  const canEdit = can("posts:publish");

  useEffect(() => {
    if (qDraft.trim() === f.q) return;
    const t = setTimeout(() => set({ q: qDraft.trim() }), 350);
    return () => clearTimeout(t);
  }, [qDraft, f.q, set]);

  const key = JSON.stringify([f.q, f.kind, f.status, f.page, reload]);
  const rows = data?.key === key ? data.rows : null;

  useEffect(() => {
    if (!can("posts:read")) return;
    const ctrl = new AbortController();
    request<ListResponse<Redirect>>("redirects", {
      query: { q: f.q, kind: f.kind === "all" ? undefined : f.kind, status: f.status === "all" ? undefined : f.status, page: f.page, per_page: PER_PAGE },
      signal: ctrl.signal,
    })
      .then((r) => {
        setData({ key, rows: r.data ?? [], meta: r.meta });
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, can, key, f.q, f.kind, f.status, f.page]);

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await request<void>(`redirects/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
      toast.success(`ลบ redirect ${deleting.from} แล้ว`);
      setDeleting(null);
      setReload((n) => n + 1);
    } catch (err) {
      setDeleting(null);
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ลบไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!can("posts:read")) {
    return (
      <>
        <PageHeader title="เปลี่ยนเส้นทาง URL" />
        <NoAccess />
      </>
    );
  }

  const filtered = f.q !== "" || f.kind !== "all" || f.status !== "all";

  return (
    <>
      <PageHeader
        title="เปลี่ยนเส้นทาง URL"
        description="ส่งผู้เข้าชมจาก URL เก่าไปหน้าใหม่ (301) หรือแจ้งว่าหน้าถูกลบถาวร (410) — ช่วยไม่ให้ลิงก์เสียและรักษาอันดับใน Google"
        actions={
          canEdit ? (
            <Button variant="primary" icon={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing("new")}>
              เพิ่ม Redirect
            </Button>
          ) : null
        }
      />

      <div className="rd-filters">
        <div className="w-full min-w-0 sm:max-w-xs sm:flex-1">
          <label htmlFor={searchId} className="adm-sr-only">
            ค้นหา URL หรือหมายเหตุ
          </label>
          <Input
            id={searchId}
            type="search"
            inputSize="sm"
            placeholder="ค้นหา URL หรือหมายเหตุ…"
            icon={<Search size={15} aria-hidden="true" />}
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") set({ q: qDraft.trim() });
            }}
          />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Select inputSize="sm" aria-label="ประเภท" value={f.kind} onChange={(e) => set({ kind: e.target.value as KindFilter })}>
            <option value="all">ทุกประเภท</option>
            <option value="manual">สร้างเอง</option>
            <option value="auto">อัตโนมัติ</option>
          </Select>
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Select inputSize="sm" aria-label="ผลลัพธ์" value={f.status} onChange={(e) => set({ status: e.target.value as StatusFilter })}>
            <option value="all">301 และ 410</option>
            <option value="301">301 ส่งต่อ</option>
            <option value="410">410 ลบถาวร</option>
          </Select>
        </div>
      </div>

      {!canEdit ? (
        <Alert tone="info" className="mb-4">
          บัญชีของคุณดูรายการได้อย่างเดียว — ต้องมีสิทธิ์เผยแพร่บทความ (posts:publish) จึงจะเพิ่มหรือแก้ไขได้
        </Alert>
      ) : null}

      {error ? (
        <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
      ) : rows === null ? (
        <ListSkeleton />
      ) : rows.length === 0 ? (
        <div className="adm-card">
          {filtered ? (
            <EmptyState
              icon={<FileSearch size={22} />}
              title="ไม่พบรายการที่ตรงกับตัวกรอง"
              description="ลองเปลี่ยนคำค้นหรือตัวกรอง"
              action={
                <Button
                  size="sm"
                  onClick={() => {
                    setQDraft("");
                    set({ q: "", kind: "all", status: "all" });
                  }}
                >
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            <EmptyState
              icon={<Shuffle size={22} />}
              title="ยังไม่มีการเปลี่ยนเส้นทาง"
              description="เมื่อยกเลิกเผยแพร่หรือลบบทความที่เผยแพร่อยู่ ระบบจะสร้างรายการให้อัตโนมัติ · การเปลี่ยน slug ของบทความจะ redirect ให้เองโดยไม่ต้องเพิ่มที่นี่"
              action={
                canEdit ? (
                  <Button size="sm" variant="primary" icon={<Plus size={15} aria-hidden="true" />} onClick={() => setEditing("new")}>
                    เพิ่ม Redirect
                  </Button>
                ) : null
              }
            />
          )}
        </div>
      ) : (
        <>
          <div className="adm-table-wrap rd-table">
            <table className="adm-table">
              <caption className="adm-sr-only">รายการเปลี่ยนเส้นทาง URL</caption>
              <thead>
                <tr>
                  <th scope="col">ต้นทาง</th>
                  <th scope="col">ปลายทาง</th>
                  <th scope="col">ประเภท</th>
                  <th scope="col">หมายเหตุ</th>
                  <th scope="col">สร้างโดย</th>
                  {canEdit ? (
                    <th scope="col">
                      <span className="adm-sr-only">จัดการ</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="max-w-[18rem]">
                      <PathText path={r.from} />
                    </td>
                    <td className="max-w-[18rem]">
                      <Target r={r} />
                    </td>
                    <td>
                      <KindBadge kind={r.kind} />
                    </td>
                    <td className="max-w-[14rem] text-sm text-muted">
                      <span className="line-clamp-2">{r.note || "—"}</span>
                    </td>
                    <td className="whitespace-nowrap text-sm text-muted">
                      {r.created_by ? r.created_by.name || r.created_by.email : r.kind === "auto" ? "ระบบ" : "—"}
                      <span className="block text-xs text-subtle">{formatDateTime(r.created_at)}</span>
                    </td>
                    {canEdit ? (
                      <td className="whitespace-nowrap text-right">
                        <IconButton label="แก้ไข" size="sm" onClick={() => setEditing(r)}>
                          <Pencil size={15} aria-hidden="true" />
                        </IconButton>
                        <IconButton label="ลบ" size="sm" variant="danger" onClick={() => setDeleting(r)}>
                          <Trash2 size={15} aria-hidden="true" />
                        </IconButton>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="rd-cards" aria-label="รายการเปลี่ยนเส้นทาง URL">
            {rows.map((r) => (
              <li key={r.id} className="rd-card">
                <div className="flex items-start justify-between gap-2">
                  <PathText path={r.from} />
                  <KindBadge kind={r.kind} />
                </div>
                <div className="flex items-start gap-1.5 text-sm">
                  <ArrowRight size={14} aria-hidden="true" className="mt-1 shrink-0 text-subtle" />
                  <Target r={r} />
                </div>
                {r.note ? <p className="text-xs text-muted">{r.note}</p> : null}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-subtle">
                    {r.created_by ? `${r.created_by.name || r.created_by.email} · ` : ""}
                    {formatDateTime(r.created_at)}
                  </span>
                  {canEdit ? (
                    <span className="flex gap-1">
                      <IconButton label="แก้ไข" size="sm" tooltip={false} onClick={() => setEditing(r)}>
                        <Pencil size={15} aria-hidden="true" />
                      </IconButton>
                      <IconButton label="ลบ" size="sm" variant="danger" tooltip={false} onClick={() => setDeleting(r)}>
                        <Trash2 size={15} aria-hidden="true" />
                      </IconButton>
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <Pagination meta={data?.meta ?? null} onPage={(p) => set({ page: p })} label="เปลี่ยนหน้ารายการ redirect" />

      <RedirectDialog
        open={editing !== null}
        row={editing === "new" ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          setReload((n) => n + 1);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="ลบ redirect นี้?"
        message={
          deleting ? (
            <>
              <span className="font-mono text-fg">{deleting.from}</span> จะไม่ถูก{deleting.status === 301 ? "ส่งต่ออีก" : "แจ้งว่าลบถาวรอีก"}{" "}
              และจะแสดงหน้า “ไม่พบหน้า” (404) แทน (ยกเว้นมีบทความที่ใช้ URL นี้อยู่)
            </>
          ) : (
            ""
          )
        }
        confirmLabel="ลบ"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </>
  );
}

function PathText({ path }: { path: string }) {
  return (
    <a href={path} target="_blank" rel="noopener" className="rd-path" title={`เปิด ${path} บนเว็บไซต์ (แท็บใหม่)`}>
      <span className="truncate">{path}</span>
      <ExternalLink size={12} aria-hidden="true" className="shrink-0" />
    </a>
  );
}

function Target({ r }: { r: Redirect }) {
  if (r.status === 410 || !r.to) {
    return (
      <Badge tone="danger" title="แจ้งว่าหน้านี้ถูกลบถาวร">
        410 ลบถาวร
      </Badge>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Badge tone="info">301</Badge>
      <span className="min-w-0 truncate font-mono text-[0.8125rem]" title={r.to}>
        {r.to}
      </span>
    </span>
  );
}

function KindBadge({ kind }: { kind: Redirect["kind"] }) {
  return kind === "auto" ? (
    <Badge tone="violet" title="สร้างอัตโนมัติเมื่อยกเลิกเผยแพร่หรือลบบทความ">
      อัตโนมัติ
    </Badge>
  ) : (
    <Badge tone="neutral">สร้างเอง</Badge>
  );
}

/* ---------------- create / edit ---------------- */

function RedirectDialog({
  open,
  row,
  onClose,
  onSaved,
}: {
  open: boolean;
  row: Redirect | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useAdmin();
  const toast = useToast();
  const formId = useId();
  const [from, setFrom] = useState("");
  const [status, setStatus] = useState<RedirectStatus>(301);
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [pick, setPick] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFrom(row?.from ?? "");
      setStatus(row?.status ?? 301);
      setTo(row?.to ?? "");
      setNote(row?.note ?? "");
      setPick(false);
      setErrors({});
      setFormError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const fromN = normalizeSitePath(from);
    const toN = status === 301 ? normalizeSitePath(to) : "";
    const v: Record<string, string> = {};
    const fe = fromPathError(fromN);
    if (fe) v.from = fe;
    if (status === 301) {
      const te = toTargetError(toN, fromN);
      if (te) v.to = te;
    }
    if ([...note].length > 500) v.note = "หมายเหตุยาวเกิน 500 ตัวอักษร";
    setFrom(fromN);
    if (status === 301) setTo(toN);
    setErrors(v);
    if (Object.keys(v).length) return;
    const body: RedirectInput = { from: fromN, to: status === 301 ? toN : null, status, note: note.trim() };
    setSaving(true);
    setFormError(null);
    try {
      const r = row
        ? await request<{ data: Redirect; flattened?: number }>(`redirects/${encodeURIComponent(row.id)}`, { method: "PUT", json: body })
        : await request<{ data: Redirect; flattened?: number }>("redirects", { method: "POST", json: body });
      const flattened = r.flattened ?? (r.data as Redirect & { flattened?: number }).flattened ?? 0;
      toast.success(
        `${row ? "บันทึก" : "เพิ่ม"} redirect แล้ว${flattened > 0 ? ` · ปรับ redirect เดิม ${flattened} รายการให้ชี้ตรงไปปลายทางใหม่ (ไม่ต่อกันเป็นทอด)` : ""}`,
      );
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 422 || err.status === 409)) {
        const fields: Record<string, string> = {};
        for (const [k, m] of Object.entries(err.fields)) {
          const key = k === "from_path" ? "from" : k === "to_path" ? "to" : k === "status_code" ? "status" : k;
          fields[key] = m;
        }
        setErrors(fields);
        const known = new Set(["from", "to", "status", "note"]);
        const shown = new Set(Object.entries(fields).filter(([k]) => known.has(k)).map(([, m]) => m));
        const extra = Object.entries(fields).filter(([k]) => !known.has(k)).map(([, m]) => m);
        setFormError([err.message, ...extra].filter((m) => m && !shown.has(m)).join(" · ") || null);
      } else if (!alreadyNotified(err)) {
        setFormError(errorMessage(err) || "บันทึกไม่สำเร็จ");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!saving}
      size="md"
      title={row ? "แก้ไข Redirect" : "เพิ่ม Redirect"}
      description={row?.kind === "auto" ? "รายการนี้ระบบสร้างอัตโนมัติจากการยกเลิกเผยแพร่หรือลบบทความ — แก้ไขได้ตามต้องการ" : undefined}
      footer={
        <>
          <Button onClick={onClose} disabled={saving}>
            ยกเลิก
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={saving} loadingText="กำลังบันทึก…">
            {row ? "บันทึก" : "เพิ่ม Redirect"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} className="grid grid-cols-[minmax(0,1fr)] gap-4" noValidate>
        {formError ? <Alert tone="danger">{formError}</Alert> : null}
        <Field
          label="URL ต้นทาง (URL เก่า)"
          required
          error={errors.from}
          hint="path ของเว็บไซต์ เช่น /knowledge/old-article — วาง URL เต็มของเว็บไซต์ได้ ระบบจะตัดเหลือ path ให้ · ภาษาไทยใช้ได้"
        >
          {(p) => (
            <Input
              {...p}
              className="font-mono"
              value={from}
              placeholder="/knowledge/…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              onChange={(e) => setFrom(e.target.value)}
              onBlur={() => from.trim() && setFrom(normalizeSitePath(from))}
            />
          )}
        </Field>

        <fieldset className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          <legend className="adm-label mb-1.5">ผลลัพธ์</legend>
          {(
            [
              [301, "ส่งต่อไปยัง URL ใหม่ (301 ถาวร)", "ผู้เข้าชมและ Google ถูกพาไปหน้าใหม่ อันดับเดิมถูกส่งต่อ"],
              [410, "แจ้งว่าหน้านี้ถูกลบถาวร (410)", "ใช้เมื่อไม่มีหน้าที่แทนได้ Google จะนำออกจากผลการค้นหา"],
            ] as [RedirectStatus, string, string][]
          ).map(([value, label, hint]) => (
            <label key={value} className="pe-status-opt" data-on={status === value || undefined}>
              <input type="radio" name={`${formId}-status`} checked={status === value} onChange={() => setStatus(value)} />
              <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-muted">{hint}</span>
              </span>
            </label>
          ))}
          {errors.status ? <p className="adm-field-error">{errors.status}</p> : null}
        </fieldset>

        {status === 301 ? (
          <div className="grid gap-2">
            <Field
              label="ปลายทาง"
              required
              error={errors.to}
              hint="path ของเว็บไซต์ (/knowledge/…) หรือ URL เต็มที่ขึ้นต้นด้วย https:// · ปลายทางต้องไม่ใช่ URL ที่ถูก redirect อยู่แล้ว"
            >
              {(p) => (
                <Input
                  {...p}
                  className="font-mono"
                  value={to}
                  placeholder="/knowledge/…"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(e) => setTo(e.target.value)}
                />
              )}
            </Field>
            <div>
              <Button size="sm" variant="ghost" icon={<Search size={14} aria-hidden="true" />} aria-expanded={pick} onClick={() => setPick((o) => !o)}>
                {pick ? "ซ่อนการค้นหาบทความ" : "เลือกจากบทความที่เผยแพร่อยู่"}
              </Button>
            </div>
            {pick ? (
              <PostSearch
                excludeId={null}
                selected={null}
                onPick={(p) => {
                  setTo(`/knowledge/${p.slug}`);
                  setPick(false);
                }}
              />
            ) : null}
          </div>
        ) : null}

        <Field label="หมายเหตุ (ไม่บังคับ)" error={errors.note} hint="เช่น เหตุผลที่ย้าย เพื่อให้ทีมเข้าใจภายหลัง">
          {(p) => <Textarea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

function ListSkeleton() {
  return (
    <div className="adm-card grid" role="status" aria-label="กำลังโหลดรายการ">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0" aria-hidden="true">
          <Skeleton className="h-3.5 w-1/3" />
          <Skeleton className="h-3.5 w-1/4" />
          <Skeleton className="ml-auto h-5 w-16" />
        </div>
      ))}
    </div>
  );
}
