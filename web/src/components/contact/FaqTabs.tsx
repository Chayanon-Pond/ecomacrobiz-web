"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { FaqCategory } from "@/content/how-we-work";

/** Answer text format (how-we-work.ts): blank line = paragraph, "- " = bullet. */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="flex flex-col gap-3 text-[0.98rem] leading-[1.9] text-muted">
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-5 marker:text-accent-soft">
              {lines.map((l, j) => (
                <li key={j}>{l.trim().slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </div>
  );
}

/**
 * FAQ grouped by category: WAI-ARIA tabs (arrow keys / Home / End) with an
 * accordion per tab. All answers are server-rendered into the HTML (hidden
 * until opened) so they stay crawlable.
 */
export function FaqTabs({ categories }: { categories: FaqCategory[] }) {
  const [tab, setTab] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const base = useId();

  const select = (i: number) => {
    setTab(i);
    tabsRef.current[i]?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const last = categories.length - 1;
    const next =
      e.key === "ArrowRight" ? (i === last ? 0 : i + 1)
      : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
  };

  return (
    <div>
      <div>
        <div role="tablist" aria-label="หมวดคำถาม" className="flex flex-wrap gap-2 py-1">
          {categories.map((c, i) => (
            <button
              key={c.id}
              ref={(el) => {
                tabsRef.current[i] = el;
              }}
              id={`${base}-tab-${c.id}`}
              type="button"
              role="tab"
              aria-selected={tab === i}
              aria-controls={`${base}-panel-${c.id}`}
              tabIndex={tab === i ? 0 : -1}
              onClick={() => setTab(i)}
              onKeyDown={(e) => onKey(e, i)}
              className="kc-tab inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border px-4 text-sm transition-colors duration-300"
            >
              <span className="font-medium">{c.labelTh ?? c.label}</span>
              <span className="font-display text-[0.7rem] tracking-[0.12em] opacity-70">{c.items.length}</span>
            </button>
          ))}
        </div>
      </div>

      {categories.map((c, i) => (
        <div
          key={c.id}
          id={`${base}-panel-${c.id}`}
          role="tabpanel"
          aria-labelledby={`${base}-tab-${c.id}`}
          hidden={tab !== i}
          tabIndex={0}
          className="mt-6 rounded-[var(--radius-card)] focus-visible:outline-offset-4"
        >
          <p className="eyebrow mb-2">{c.label}</p>
          <ul className="divide-y divide-line border-y border-line">
            {c.items.map((q) => {
              const isOpen = open === q.id;
              const btnId = `${base}-q-${q.id}`;
              const panelId = `${base}-a-${q.id}`;
              return (
                <li key={q.id}>
                  <h3>
                    <button
                      id={btnId}
                      type="button"
                      aria-expanded={isOpen}
                      aria-controls={panelId}
                      onClick={() => setOpen(isOpen ? null : q.id)}
                      className="kc-q flex w-full items-start justify-between gap-6 py-5 text-left"
                    >
                      <span className="thai-heading text-[1.02rem] font-medium text-fg sm:text-lg">{q.question}</span>
                      <span
                        aria-hidden="true"
                        className={`mt-1 grid size-7 shrink-0 place-items-center rounded-full border border-line-strong transition-transform duration-300 ${
                          isOpen ? "rotate-45 border-accent bg-accent text-white" : ""
                        }`}
                      >
                        <svg viewBox="0 0 16 16" className="size-3.5">
                          <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                        </svg>
                      </span>
                    </button>
                  </h3>
                  <div id={panelId} role="region" aria-labelledby={btnId} hidden={!isOpen} className="pb-6 pr-2 sm:pr-14">
                    <Answer text={q.answer} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
