"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { downloadResponse, toApiError } from "@/lib/admin/client";
import { CHANNEL_LABEL, formatDateTime, LEAD_STATUS_LABEL, LEAD_STATUSES } from "@/lib/admin/format";
import type { Lead, LeadStatus, ListResponse, PageMeta } from "@/lib/admin/types";
import { PageHeader, Spinner } from "./AdminShell";
import { Pagination, SearchBox, useListParams } from "./ListControls";
import { errorMessage, useAdmin } from "./SessionProvider";
import { useToast } from "./Toast";

const PER_PAGE = 25;

export const LEAD_TONE: Record<LeadStatus, string> = {
  new: "blue",
  contacted: "amber",
  qualified: "green",
  closed: "",
  spam: "red",
};

export function leadName(l: Pick<Lead, "first_name" | "last_name">) {
  return [l.first_name, l.last_name].filter(Boolean).join(" ") || "—";
}

export function preferredSlot(l: Pick<Lead, "preferred_date" | "preferred_time">) {
  if (!l.preferred_date && !l.preferred_time) return "—";
  let d = l.preferred_date ?? "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) {
    d = new Intl.DateTimeFormat("th-TH", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(
      Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
    );
  }
  return [d, l.preferred_time].filter(Boolean).join(" ");
}

export function LeadsList() {
  const { request, requestRaw } = useAdmin();
  const toast = useToast();
  const { status, q, page, set } = useListParams("");
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    request<ListResponse<Lead>>("leads", {
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

  async function exportCsv() {
    setExporting(true);
    try {
      const res = await requestRaw("leads/export.csv", { query: { status } });
      if (!res.ok) throw await toApiError(res);
      await downloadResponse(res, `leads${status ? `-${status}` : ""}.csv`);
    } catch (err) {
      toast(errorMessage(err) || "ส่งออกไม่สำเร็จ", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <PageHeader
        title="รายชื่อผู้ติดต่อ"
        subtitle="Leads · จากฟอร์มนัดปรึกษาในหน้า Contact"
        actions={
          <button type="button" className="adm-btn" onClick={exportCsv} disabled={exporting}>
            {exporting ? "กำลังส่งออก…" : `ส่งออก CSV${status ? ` (${LEAD_STATUS_LABEL[status as LeadStatus] ?? status})` : ""}`}
          </button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div>
          <label htmlFor="lead-status" className="sr-only">
            กรองตามสถานะ
          </label>
          <select id="lead-status" className="adm-input min-w-[12rem]" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="">ทุกสถานะ (All)</option>
            {LEAD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {LEAD_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        <SearchBox value={q} onSearch={onSearch} label="ค้นหาชื่อ บริษัท อีเมล เบอร์โทร…" />
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
          <table className="adm-table min-w-[62rem]">
            <thead>
              <tr>
                <th scope="col">วันที่ส่ง</th>
                <th scope="col">ชื่อ</th>
                <th scope="col">บริษัท</th>
                <th scope="col">โทรศัพท์</th>
                <th scope="col">อีเมล</th>
                <th scope="col">ช่องทาง</th>
                <th scope="col">วัน/เวลาที่สะดวก</th>
                <th scope="col">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-muted">
                    ไม่พบรายชื่อผู้ติดต่อ
                  </td>
                </tr>
              ) : (
                rows.map((l) => (
                  <tr key={l.id}>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(l.created_at)}</td>
                    <td>
                      <Link href={`/admin/leads/${encodeURIComponent(l.id)}`} className="font-medium hover:underline">
                        {leadName(l)}
                      </Link>
                    </td>
                    <td className="text-muted">{l.company || "—"}</td>
                    <td className="whitespace-nowrap">
                      {l.phone ? (
                        <a href={`tel:${l.phone}`} className="hover:underline">
                          {l.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="max-w-[14rem] truncate">
                      {l.email ? (
                        <a href={`mailto:${l.email}`} className="hover:underline">
                          {l.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap text-muted">{CHANNEL_LABEL[l.preferred_channel] ?? l.preferred_channel}</td>
                    <td className="whitespace-nowrap text-muted">{preferredSlot(l)}</td>
                    <td>
                      <span className="adm-badge" data-tone={LEAD_TONE[l.status] || undefined}>
                        {LEAD_STATUS_LABEL[l.status] ?? l.status}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      <Pagination meta={meta} onPage={(p) => set({ page: p })} />
    </>
  );
}
