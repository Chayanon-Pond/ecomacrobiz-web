"use client";

import { useEffect, useRef, useState } from "react";
import { useGsap } from "@/lib/animations/use-gsap";

type Item = { id: string; index: string; label: string };

/**
 * Sticky chapter navigation for /solutions.
 * - `variant="rail"`: desktop side rail with a progress line scrubbed by
 *   scroll (GSAP, motion on only).
 * - `variant="chips"`: phones/tablets, a horizontally scrollable chip bar
 *   under the header (scrolls inside itself, never widens the page).
 * The active chapter comes from IntersectionObserver, so it also works with
 * reduced motion.
 */
export function ChapterIndex({
  items,
  variant,
  containerId,
}: {
  items: Item[];
  variant: "rail" | "chips";
  containerId: string;
}) {
  const [active, setActive] = useState(items[0]?.id ?? "");
  const chipsRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const sections = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => !!el);
    if (sections.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActive(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, [items]);

  // Keep the active chip in view inside the chip bar (horizontal only).
  useEffect(() => {
    if (variant !== "chips") return;
    const list = chipsRef.current;
    const chip = list?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (!list || !chip) return;
    const left = chip.offsetLeft - list.clientWidth / 2 + chip.clientWidth / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [active, variant]);

  const lineRef = useGsap<HTMLDivElement>(({ gsap }, el) => {
    if (variant !== "rail") return;
    const container = document.getElementById(containerId);
    const fill = el.querySelector<HTMLElement>("[data-progress-fill]");
    if (!container || !fill) return;
    gsap.fromTo(
      fill,
      { scaleY: 0 },
      {
        scaleY: 1,
        ease: "none",
        scrollTrigger: { trigger: container, start: "top 40%", end: "bottom 60%", scrub: 0.3 },
      },
    );
  });

  if (variant === "chips") {
    return (
      <nav aria-label="หมวดโซลูชัน" className="glass border-b border-line">
        <ul
          ref={chipsRef}
          className="container-page flex gap-2 overflow-x-auto py-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {items.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  data-chip={item.id}
                  aria-current={isActive ? "true" : undefined}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-full border px-4 font-display text-sm font-medium transition-colors ${
                    isActive
                      ? "border-accent bg-accent text-white"
                      : "border-line-strong text-muted hover:text-fg"
                  }`}
                >
                  <span className="text-xs opacity-80">{item.index}</span>
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="หมวดโซลูชัน" className="relative">
      <p className="eyebrow mb-6">CHAPTERS</p>
      <div ref={lineRef} className="relative pl-6">
        <div aria-hidden="true" className="absolute bottom-2 left-0 top-2 w-px bg-line-strong">
          <div
            data-progress-fill
            className="h-full w-full origin-top bg-accent-soft [[data-motion=reduced]_&]:hidden"
          />
        </div>
        <ol className="flex flex-col gap-1">
          {items.map((item) => {
            const isActive = item.id === active;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  data-cursor="hover"
                  aria-current={isActive ? "true" : undefined}
                  className={`group flex min-h-11 items-center gap-3 rounded-lg py-2 transition-colors ${
                    isActive ? "text-fg" : "text-subtle hover:text-fg"
                  }`}
                >
                  <span
                    className={`font-display text-xs font-semibold tracking-[0.2em] ${
                      isActive ? "text-accent-soft" : ""
                    }`}
                  >
                    {item.index}
                  </span>
                  <span className="font-display text-[0.95rem] font-semibold leading-tight">
                    {item.label}
                  </span>
                </a>
              </li>
            );
          })}
        </ol>
      </div>
    </nav>
  );
}
