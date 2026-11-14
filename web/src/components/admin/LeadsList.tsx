"use client";

/**
 * /admin/leads — table + kanban board (choice remembered per browser),
 * filters in the URL (status, q, assigned, from, to, page) and a detail
 * drawer (?lead=<id>).
 */
import { Columns3, Download, Filter, Rows3, Users, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { downloadResponse, toApiError } from "@/lib/admin/client";
import { CHANNEL_LABEL, formatDateTime, LEAD_STATUSES } from "@/lib/admin/format";
import { formatRelative } from "@/lib/admin/time";
import type { Lead, LeadBoard, LeadStatus, ListResponse, PageMeta } from "@/lib/admin/types";
import { LeadPanel } from "./leads/LeadPanel";
import { LeadsBoardView, moveInBoard } from "./leads/LeadsBoard";
import { leadName, preferredSlot, userLabel } from "./leads/lead-utils";
import { SearchBox } from "./ListControls";
import { alreadyNotified, errorMessage, useAdmin } from "./SessionProvider";
import { PREF_KEYS, usePref } from "./shell/prefs";
import { LEAD_STATUS_SHORT, LeadStatusBadge } from "./ui/Badge";
import { Button } from "./ui/Button";
import { Drawer } from "./ui/Drawer";
import { EmptyState, ErrorState, NoAccess } from "./ui/EmptyState";
import { Input, Select } from "./ui/Field";
import { PageHeader } from "./ui/PageHeader";
import { Pagination } from "./ui/Pagination";
import { Skeleton, TableSkeleton } from "./ui/Skeleton";
import { Table } from "./ui/Table";
import { SegmentedControl } from "./ui/Tabs";
import { useToast } from "./ui/Toast";

export { leadName, preferredSlot };
/** @deprecated use LEAD_STATUS_TONE from ./ui/Badge */
export const LEAD_TONE: Record<LeadStatus, string> = { new: "blue", contacted: "amber", qualified: "green", closed: "", spam: "red" };

const PER_PAGE = 25;
const VIEWS = ["table", "board"] as const;
type View = (typeof VIEWS)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Filters = { status: string; q: string; assigned: string; from: string; to: string; page: number; lead: string };

function useLeadParams() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f: Filters = {
    status: (LEAD_STATUSES as string[]).includes(sp.get("status") ?? "") ? (sp.get("status") as string) : "",
    q: sp.get("q") ?? "",
    assigned: sp.get("assigned") ?? "",
    from: DATE_RE.test(sp.get("from") ?? "") ? (sp.get("from") as string) : "",
    to: DATE_RE.test(sp.get("to") ?? "") ? (sp.get("to") as string) : "",
    page: Math.max(1, Number(sp.get("page")) || 1),
    lead: sp.get("lead") ?? "",
  };
  const set = useCallback(
    (patch: Partial<Filters>) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === "" || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (Object.keys(patch).some((k) => k !== "page" && k !== "lead")) next.delete("page");
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );
  return { f, set };
}

export function LeadsList() {
  const { request, requestRaw, can } = useAdmin();
  const toast = useToast();
  const { f, set } = useLeadParams();
  const [view, setView] = usePref<View>(PREF_KEYS.leadsView, "table", VIEWS);
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // table
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  // board
  const [board, setBoard] = useState<LeadBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const readable = can("leads:read");
  const writable = can("leads:write");

  useEffect(() => {
    if (!readable || view !== "table") return;
    const ctrl = new AbortController();
    request<ListResponse<Lead>>("leads", {
      query: { status: f.status, q: f.q, assigned: f.assigned, from: f.from, to: f.to, page: f.page, per_page: PER_PAGE },
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
  }, [request, readable, view, f.status, f.q, f.assigned, f.from, f.to, f.page, reload]);

  useEffect(() => {
    if (!readable || view !== "board") return;
    const ctrl = new AbortController();
    request<{ data: LeadBoard }>("leads/board", { query: { q: f.q, assigned: f.assigned }, signal: ctrl.signal })
      .then((r) => {
        setBoard(r.data);
        setError(null);
      })
      .catch((err) => {
        const m = errorMessage(err);
        if (m) setError(m);
      });
    return () => ctrl.abort();
  }, [request, readable, view, f.q, f.assigned, reload]);

  const onSearch = useCallback((v: string) => set({ q: v }), [set]);

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await requestRaw("leads/export.csv", { query: { status: f.status } });
      if (!res.ok) throw await toApiError(res);
      await downloadResponse(res, `leads${f.status ? `-${f.status}` : ""}.csv`);
      toast.success("ดาวน์โหลดไฟล์ CSV แล้ว");
    } catch (err) {
      if (!alreadyNotified(err)) toast.error(errorMessage(err) || "ส่งออกไม่สำเร็จ");
    } finally {
      setExporting(false);
    }
  }

  /** Optimistic status move from the board (drag or menu). */
  const moveLead = useCallback(
    async (lead: Lead, to: LeadStatus) => {
      setBoard((b) => (b ? moveInBoard(b, lead, to) : b));
      try {
        const r = await request<{ data: Lead }>(`leads/${encodeURIComponent(lead.id)}`, { method: "PATCH", json: { status: to } });
        setBoard((b) => (b ? { ...b, columns: { ...b.columns, [to]: b.columns[to].map((l) => (l.id === lead.id ? r.data : l)) } } : b));
        toast.success(`ย้าย ${leadName(lead)} ไป “${LEAD_STATUS_SHORT[to]}” แล้ว`);
      } catch (err) {
        // Roll back just this card (other moves made meanwhile stay).
        setBoard((b) => (b ? moveInBoard(b, { ...lead, status: to }, lead.status) : b));
        if (!alreadyNotified(err)) toast.error(`ย้ายไม่สำเร็จ: ${errorMessage(err) || "กรุณาลองใหม่"}`);
      }
    },
    [request, toast],
  );

  /** Drawer saved a change: reflect it in the table / board without reloading. */
  const onLeadChanged = useCallback((l: Lead) => {
    setRows((rs) => (rs ? rs.map((x) => (x.id === l.id ? l : x)) : rs));
    setBoard((b) => {
      if (!b) return b;
      const prev = LEAD_STATUSES.flatMap((s) => b.columns[s]).find((x) => x.id === l.id);
      if (!prev) return b;
      const moved = prev.status !== l.status ? moveInBoard(b, prev, l.status) : b;
      return { ...moved, columns: { ...moved.columns, [l.status]: moved.columns[l.status].map((x) => (x.id === l.id ? l : x)) } };
    });
  }, []);

  const activeFilters = useMemo(
    () => [f.status && view === "table", f.assigned, (f.from || f.to) && view === "table"].filter(Boolean).length,
    [f.status, f.assigned, f.from, f.to, view],
  );

  if (!readable) {
    return (
      <>
        <PageHeader title="รายชื่อผู้ติดต่อ" />
        <NoAccess />
      </>
    );
  }

  const filterControls = (
    <>
      {view === "table" ? (
        <Select aria-label="กรองตามสถานะ" value={f.status} onChange={(e) => set({ status: e.target.value })} className="sm:w-40">
          <option value="">ทุกสถานะ</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_SHORT[s]}
            </option>
          ))}
        </Select>
      ) : null}
      <Select aria-label="กรองตามผู้รับผิดชอบ" value={f.assigned} onChange={(e) => set({ assigned: e.target.value })} className="sm:w-44">
        <option value="">ผู้รับผิดชอบทั้งหมด</option>
        <option value="me">มอบหมายให้ฉัน</option>
        <option value="none">ยังไม่มอบหมาย</option>
      </Select>
      {view === "table" ? (
        <div className="flex items-center gap-1.5">
          <Input type="date" aria-label="ตั้งแต่วันที่" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} className="sm:w-40" />
          <span className="text-muted" aria-hidden="true">
            –
          </span>
          <Input type="date" aria-label="ถึงวันที่" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} className="sm:w-40" />
        </div>
      ) : null}
      {activeFilters > 0 ? (
        <Button variant="ghost" size="sm" icon={<X size={14} aria-hidden="true" />} onClick={() => set({ status: "", assigned: "", from: "", to: "" })}>
          ล้างตัวกรอง
        </Button>
      ) : null}
    </>
  );

  return (
    <>
      <PageHeader
        title="รายชื่อผู้ติดต่อ"
        description="Leads จากฟอร์มนัดปรึกษาในหน้า Contact"
        actions={
          <>
            <SegmentedControl<View>
              label="มุมมอง"
              value={view}
              onChange={setView}
              options={[
                { value: "table", label: <span className="max-sm:sr-only">ตาราง</span>, ariaLabel: "มุมมองตาราง", icon: <Rows3 size={15} aria-hidden="true" /> },
                { value: "board", label: <span className="max-sm:sr-only">บอร์ด</span>, ariaLabel: "มุมมองบอร์ด", icon: <Columns3 size={15} aria-hidden="true" /> },
              ]}
            />
            {can("leads:export") ? (
              <Button onClick={exportCsv} loading={exporting} icon={<Download size={16} aria-hidden="true" />}>
                ส่งออก CSV{f.status ? ` (${LEAD_STATUS_SHORT[f.status as LeadStatus]})` : ""}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-4 grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SearchBox value={f.q} onSearch={onSearch} label="ค้นหาชื่อ บริษัท อีเมล เบอร์โทร…" />
          <Button
            className="md:hidden"
            icon={<Filter size={15} aria-hidden="true" />}
            aria-expanded={filtersOpen}
            aria-controls="lead-filters"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            ตัวกรอง{activeFilters ? ` (${activeFilters})` : ""}
          </Button>
          <div id="lead-filters" className={`${filtersOpen ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 md:flex md:w-auto`}>
            {filterControls}
          </div>
        </div>
        {view === "board" && !writable ? <p className="text-xs text-muted">มุมมองอ่านอย่างเดียว — บทบาทของคุณไม่สามารถเปลี่ยนสถานะได้</p> : null}
      </div>

      {error && (view === "table" ? rows === null : board === null) ? (
        <div className="adm-card">
          <ErrorState message={error} onRetry={() => setReload((n) => n + 1)} />
        </div>
      ) : view === "table" ? (
        <LeadsTable rows={rows} meta={meta} onOpen={(id) => set({ lead: id })} onPage={(p) => set({ page: p })} filtered={Boolean(f.q || activeFilters)} />
      ) : board ? (
        <LeadsBoardView board={board} writable={writable} onMove={moveLead} onOpen={(id) => set({ lead: id })} />
      ) : (
        <div className="adm-board" aria-busy="true">
          {LEAD_STATUSES.map((s) => (
            <div key={s} className="adm-board-col grid gap-2 p-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      )}

      <Drawer open={Boolean(f.lead)} onClose={() => set({ lead: "" })} title="รายละเอียดผู้ติดต่อ" width="38rem">
        {f.lead ? <LeadPanel key={f.lead} id={f.lead} onChanged={onLeadChanged} /> : null}
      </Drawer>
    </>
  );
}

function LeadsTable({
  rows,
  meta,
  onOpen,
  onPage,
  filtered,
}: {
  rows: Lead[] | null;
  meta: PageMeta | null;
  onOpen: (id: string) => void;
  onPage: (p: number) => void;
  filtered: boolean;
}) {
  if (rows === null) return <TableSkeleton rows={8} cols={6} />;
  if (rows.length === 0) {
    return (
      <div className="adm-card">
        <EmptyState
          icon={<Users size={22} />}
          title={filtered ? "ไม่พบผู้ติดต่อตามเงื่อนไข" : "ยังไม่มีผู้ติดต่อ"}
          description={filtered ? "ลองเปลี่ยนคำค้นหาหรือล้างตัวกรอง" : "เมื่อมีคนส่งฟอร์มนัดปรึกษาจากหน้า Contact รายชื่อจะแสดงที่นี่"}
        />
      </div>
    );
  }
  return (
    <>
      <Table caption="รายชื่อผู้ติดต่อ" minWidth="56rem">
        <thead>
          <tr>
            <th scope="col">ผู้ติดต่อ</th>
            <th scope="col">ช่องทางติดต่อ</th>
            <th scope="col">สะดวก</th>
            <th scope="col">ผู้รับผิดชอบ</th>
            <th scope="col">ส่งเมื่อ</th>
            <th scope="col">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} data-clickable onClick={() => onOpen(l.id)}>
              <td>
                <button
                  type="button"
                  className="block max-w-[16rem] truncate text-left font-medium hover:underline"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(l.id);
                  }}
                >
                  {leadName(l)}
                </button>
                <span className="block max-w-[16rem] truncate text-xs text-muted">{l.company || "—"}</span>
              </td>
              <td className="text-sm">
                <span className="block max-w-[15rem] truncate">{l.phone || "—"}</span>
                <span className="block max-w-[15rem] truncate text-xs text-muted">{l.email || l.line_id || ""}</span>
              </td>
              <td className="whitespace-nowrap text-sm">
                <span className="block">{CHANNEL_LABEL[l.preferred_channel] ?? l.preferred_channel}</span>
                <span className="block text-xs text-muted">{preferredSlot(l)}</span>
              </td>
              <td className="max-w-[10rem] truncate text-sm text-muted">{userLabel(l.assigned_to)}</td>
              <td className="whitespace-nowrap text-sm">
                <span className="block">{formatRelative(l.created_at)}</span>
                <span className="block text-xs text-muted">{formatDateTime(l.created_at)}</span>
              </td>
              <td>
                <LeadStatusBadge status={l.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Pagination meta={meta} onPage={onPage} />
    </>
  );
}

