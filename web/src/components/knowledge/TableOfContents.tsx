"use client";

import { useEffect, useId, useState } from "react";
import type { Heading } from "@/components/content/Markdown";

/**
 * Article TOC. One instance serves both layouts:
 * - < lg: collapsible panel above the body (button + aria-expanded)
 * - >= lg: always-open sticky list in the side column
 * The active heading is tracked with IntersectionObserver. Links are plain
 * #anchors, so Lenis (anchors option) or the browser handles the scroll and
 * scroll-padding/scroll-margin keep headings clear of the sticky header.
 */
export function TableOfContents({ headings }: { headings: Heading[] }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const listId = useId();

  useEffect(() => {
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting);
        // First heading inside the reading band wins; otherwise keep the last one passed.
        const inBand = els.find((el) => visible.get(el.id));
        if (inBand) {
          setActive(inBand.id);
          return;
        }
        const passed = els.filter((el) => el.getBoundingClientRect().top < window.innerHeight * 0.3);
        setActive(passed.length ? passed[passed.length - 1].id : null);
      },
      { rootMargin: "-15% 0px -65% 0px", threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings]);

  const onNavigate = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    if (!el) return;
    // Move focus for keyboard/screen-reader users without a second scroll jump.
    if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
    requestAnimationFrame(() => el.focus({ preventScroll: true }));
  };

  return (
    <nav aria-label="สารบัญบทความ" className="kn-toc rounded-[var(--radius-card)] border border-line bg-surface/70 lg:border-0 lg:bg-transparent">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center justify-between gap-4 px-5 text-left font-medium lg:hidden"
      >
        <span>สารบัญ</span>
        <svg
          viewBox="0 0 20 20"
          aria-hidden="true"
          className={`size-4 transition-transform duration-300 ${open ? "rotate-180" : ""}`}
        >
          <path d="m5 7.5 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <p className="eyebrow mb-4 hidden lg:block">สารบัญ</p>
      <ol id={listId} data-open={open} className="kn-toc-list px-5 pb-4 lg:px-0 lg:pb-0">
        {headings.map((h) => (
          <li key={h.id} className={h.depth === 3 ? "pl-4" : ""}>
            <a
              href={`#${h.id}`}
              onClick={() => onNavigate(h.id)}
              aria-current={active === h.id ? "location" : undefined}
              className="kn-toc-link block border-l-2 py-1.5 pl-3 text-sm leading-[1.6] transition-colors duration-300"
            >
              {h.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
