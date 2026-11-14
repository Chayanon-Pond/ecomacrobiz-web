"use client";

import { Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { cx } from "./cx";

/** Debounced search input (350 ms, Enter searches immediately). `value` is the committed query (e.g. from the URL). */
export function SearchBox({
  value,
  onSearch,
  label,
  className,
}: {
  value: string;
  onSearch: (q: string) => void;
  label: string;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(value);
  }
  useEffect(() => {
    if (draft.trim() === value) return;
    const t = setTimeout(() => onSearch(draft.trim()), 350);
    return () => clearTimeout(t);
  }, [draft, value, onSearch]);

  return (
    <div className={cx("min-w-[12rem] flex-1 sm:max-w-xs", className)}>
      <label className="adm-sr-only" htmlFor={id}>
        {label}
      </label>
      <span className="adm-input-wrap block">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
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
