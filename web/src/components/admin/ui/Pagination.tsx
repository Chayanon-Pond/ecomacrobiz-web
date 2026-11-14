"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PageMeta } from "@/lib/admin/types";

/** 1 … 4 5 [6] 7 8 … 20 */
function pageList(page: number, total: number): (number | "gap")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const start = Math.max(2, page - 1);
  const end = Math.min(total - 1, page + 1);
  if (start > 2) out.push("gap");
  for (let p = start; p <= end; p++) out.push(p);
  if (end < total - 1) out.push("gap");
  out.push(total);
  return out;
}

export function Pagination({
  meta,
  onPage,
  label = "เปลี่ยนหน้า",
}: {
  meta: PageMeta | null;
  onPage: (p: number) => void;
  label?: string;
}) {
  if (!meta) return null;
  const from = meta.total === 0 ? 0 : (meta.page - 1) * meta.per_page + 1;
  const to = Math.min(meta.total, meta.page * meta.per_page);
  const summary = (
    <p>
      {meta.total === 0
        ? "ไม่มีรายการ"
        : `แสดง ${from.toLocaleString("th-TH")}–${to.toLocaleString("th-TH")} จาก ${meta.total.toLocaleString("th-TH")} รายการ`}
    </p>
  );
  if (meta.total_pages <= 1) return <div className="adm-pager">{summary}</div>;
  return (
    <nav aria-label={label} className="adm-pager">
      {summary}
      <div className="adm-pager-pages">
        <button type="button" aria-label="หน้าก่อนหน้า" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          <ChevronLeft size={16} aria-hidden="true" className="mx-auto" />
        </button>
        {pageList(meta.page, meta.total_pages).map((p, i) =>
          p === "gap" ? (
            <span key={`g${i}`} className="adm-pager-gap" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === meta.page ? "page" : undefined}
              aria-label={`หน้า ${p}`}
              onClick={() => p !== meta.page && onPage(p)}
              className="hidden sm:inline-block"
            >
              {p}
            </button>
          ),
        )}
        <span className="px-2 tabular-nums sm:hidden" aria-hidden="true">
          {meta.page} / {meta.total_pages}
        </span>
        <button
          type="button"
          aria-label="หน้าถัดไป"
          disabled={meta.page >= meta.total_pages}
          onClick={() => onPage(meta.page + 1)}
        >
          <ChevronRight size={16} aria-hidden="true" className="mx-auto" />
        </button>
      </div>
    </nav>
  );
}
