"use client";

import "./how-we-work.css";
import { useEffect, useRef, useState } from "react";
import type { FaqCategory } from "@/content/how-we-work";
import { getLenis } from "@/lib/animations/scroll-store";

/** Renders an answer: blank line = paragraph, "- " lines = bullet list. */
function Answer({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split("\n");
        if (lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="flex list-disc flex-col gap-2 pl-5 marker:text-accent-soft">
              {lines.map((l, j) => (
                <li key={j}>{l.slice(2)}</li>
              ))}
            </ul>
          );
        }
        return <p key={i}>{block}</p>;
      })}
    </>
  );
}

/**
 * FAQ: WAI-ARIA tabs (automatic activation, Arrow/Home/End) + accordion.
 * Every panel and every answer is server-rendered (inactive tab panels use
 * the `hidden` attribute), so all Q&As are in the HTML for SEO. A <noscript>
 * style opens everything when JS is unavailable.
 * Deep link: /how-we-work#faq-<categoryId> selects that tab.
 */
export function FaqTabs({ categories }: { categories: FaqCategory[] }) {
  const [activeId, setActiveId] = useState(categories[0]?.id ?? "");
  const [openIds, setOpenIds] = useState<Set<string>>(
    () => new Set(categories.map((c) => c.items[0]?.id).filter(Boolean) as string[]),
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const fromHash = () => {
      const m = /^#faq-(.+)$/.exec(window.location.hash);
      const cat = m && categories.find((c) => c.id === m[1]);
      if (!cat) return;
      setActiveId(cat.id);
      const tab = tabRefs.current[cat.id];
      if (!tab) return;
      const lenis = getLenis();
      if (lenis) lenis.scrollTo(tab, { offset: -120, immediate: true });
      else tab.scrollIntoView({ block: "start" });
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, [categories]);

  const select = (id: string, focus = false) => {
    setActiveId(id);
    if (focus) tabRefs.current[id]?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = categories.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next === null) return;
    e.preventDefault();
    select(categories[next].id, true);
  };

  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="hww-faq">
      <noscript>
        <style>{`.hww-faq [role="tabpanel"][hidden]{display:block!important}.hww-faq .hww-faq-panel{grid-template-rows:1fr!important}.hww-faq .hww-faq-panel>div{visibility:visible!important}.hww-faq [role="tablist"]{display:none!important}`}</style>
      </noscript>

      <div
        role="tablist"
        aria-label="หมวดคำถามที่พบบ่อย"
        aria-orientation="horizontal"
        className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-4"
      >
        {categories.map((c, i) => {
          const selected = c.id === activeId;
          return (
            <button
              key={c.id}
              ref={(el) => {
                tabRefs.current[c.id] = el;
              }}
              id={`faq-${c.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`faq-panel-${c.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(c.id)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
              data-cursor="hover"
              className={`flex min-h-16 scroll-mt-[calc(var(--header-h)+2rem)] items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-300 sm:px-5 ${
                selected
                  ? "border-accent bg-accent/15 text-fg"
                  : "border-line text-muted hover:border-line-strong hover:text-fg"
              }`}
            >
              <span className="min-w-0">
                <span className="block font-display text-[0.98rem] font-semibold leading-tight">{c.label}</span>
                {c.labelTh && <span className="mt-0.5 block text-xs leading-snug text-subtle">{c.labelTh}</span>}
              </span>
              <span
                aria-hidden="true"
                className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full font-display text-xs font-semibold ${
                  selected ? "bg-accent text-white" : "bg-surface-2 text-muted"
                }`}
              >
                {c.items.length}
              </span>
              <span className="sr-only"> ({c.items.length} คำถาม)</span>
            </button>
          );
        })}
      </div>

      {categories.map((c) => (
        <div
          key={c.id}
          id={`faq-panel-${c.id}`}
          role="tabpanel"
          aria-labelledby={`faq-${c.id}`}
          hidden={c.id !== activeId}
          tabIndex={0}
          className="mt-8 rounded-[var(--radius-card)] focus-visible:outline-offset-8"
        >
          <h3 className="sr-only">{c.label}</h3>
          <ul className="divide-y divide-line border-y border-line">
            {c.items.map((item, n) => {
              const open = openIds.has(item.id);
              return (
                <li key={item.id}>
                  <h4 className="m-0">
                    <button
                      type="button"
                      id={`faq-q-${item.id}`}
                      aria-expanded={open}
                      aria-controls={`faq-a-${item.id}`}
                      onClick={() => toggle(item.id)}
                      data-cursor="hover"
                      className="group flex w-full items-start gap-4 py-6 text-left sm:gap-6 sm:py-7"
                    >
                      <span className="pt-1 font-display text-xs font-semibold tracking-[0.2em] text-accent-soft">
                        {String(n + 1).padStart(2, "0")}
                      </span>
                      <span className="thai-heading flex-1 text-[clamp(1.02rem,1.6vw,1.25rem)] font-semibold text-fg transition-colors group-hover:text-white">
                        {item.question}
                      </span>
                      <span
                        aria-hidden="true"
                        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong text-fg group-hover:border-fg/50"
                      >
                        <svg viewBox="0 0 20 20" className="hww-faq-icon size-4">
                          <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                        </svg>
                      </span>
                    </button>
                  </h4>
                  <div
                    id={`faq-a-${item.id}`}
                    role="region"
                    aria-labelledby={`faq-q-${item.id}`}
                    data-open={open}
                    className="hww-faq-panel"
                  >
                    <div>
                      <div className="flex max-w-3xl flex-col gap-4 pb-7 pl-[calc(1rem+1.5rem)] pr-2 text-[0.98rem] leading-[1.9] text-muted sm:pl-[calc(1.5rem+1.6rem)]">
                        <Answer text={item.answer} />
                      </div>
                    </div>
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
