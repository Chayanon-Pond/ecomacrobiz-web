"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import type { PageMeta } from "@/lib/admin/types";
import { Pagination as UiPagination } from "./ui/Pagination";

/** status / q / page kept in the URL so filters survive reloads and back/forward. */
export function useListParams(defaultStatus = "") {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = sp.get("status") ?? defaultStatus;
  const q = sp.get("q") ?? "";
  const page = Math.max(1, Number(sp.get("page")) || 1);

  const set = useCallback(
    (patch: { status?: string; q?: string; page?: number }) => {
      const next = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        if (v === "" || (k === "page" && v === 1)) next.delete(k);
        else next.set(k, String(v));
      }
      if (patch.status !== undefined || patch.q !== undefined) next.delete("page");
      const s = next.toString();
      router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  return { status, q, page, set };
}

export function SearchBox({ value, onSearch, label }: { value: string; onSearch: (q: string) => void; label: string }) {
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  useEffect(() => {
    if (draft === value) return;
    const t = setTimeout(() => onSearch(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onSearch]);

  return (
    <div className="min-w-0 flex-1 sm:max-w-xs">
      <label className="sr-only" htmlFor="adm-search">
        {label}
      </label>
      <span className="adm-input-wrap block">
        <Search size={16} aria-hidden="true" />
      <input
        id="adm-search"
        type="search"
        className="adm-input"
        placeholder={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") onSearch(draft.trim());
        }}
      />
      </span>
    </div>
  );
}

/** Kept for older callers; delegates to the UI kit pagination. */
export function Pagination({ meta, onPage }: { meta: PageMeta | null; onPage: (p: number) => void }) {
  return <UiPagination meta={meta} onPage={onPage} />;
}
