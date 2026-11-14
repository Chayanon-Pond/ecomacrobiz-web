"use client";

import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";

export type SegOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; ariaLabel?: string };

function arrowNav(e: KeyboardEvent<HTMLElement>, count: number, current: number, go: (i: number) => void) {
  let next = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (current + 1) % count;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (current - 1 + count) % count;
  else if (e.key === "Home") next = 0;
  else if (e.key === "End") next = count - 1;
  if (next >= 0) {
    e.preventDefault();
    go(next);
  }
}

/** Single-choice toggle (radiogroup): view switches, filters with 2–5 options. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  return (
    <div role="radiogroup" aria-label={label} className={cx("adm-seg", className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          aria-label={o.ariaLabel}
          tabIndex={i === idx ? 0 : -1}
          onClick={() => onChange(o.value)}
          onKeyDown={(e) =>
            arrowNav(e, options.length, i, (n) => {
              onChange(options[n].value);
              refs.current[n]?.focus();
            })
          }
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Tabs (tablist). Render the panel yourself with
 *   <div role="tabpanel" id={`${idBase}-panel-${value}`} aria-labelledby={`${idBase}-tab-${value}`}>
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idBase,
  className,
}: {
  tabs: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  idBase: string;
  className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className={cx("adm-tablist", className)}>
      {tabs.map((t, i) => (
        <button
          key={t.value}
          ref={(el) => {
            refs.current[i] = el;
          }}
          id={`${idBase}-tab-${t.value}`}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          aria-controls={`${idBase}-panel-${t.value}`}
          tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}
          onKeyDown={(e) =>
            arrowNav(e, tabs.length, i, (n) => {
              onChange(tabs[n].value);
              refs.current[n]?.focus();
            })
          }
        >
          {t.icon}
          {t.label}
        </button>
      ))}
    </div>
  );
}
