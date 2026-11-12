"use client";

import { useEffect, useRef } from "react";

/**
 * Thin progress bar for the article body. Decorative (aria-hidden); updates
 * via rAF on scroll/resize with a transform only (no layout work). Works the
 * same with reduced motion — it simply follows the scroll position.
 */
export function ReadingProgress({ targetId }: { targetId: string }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    const target = document.getElementById(targetId);
    if (!bar || !target) return;
    let raf = 0;

    const update = () => {
      raf = 0;
      const rect = target.getBoundingClientRect();
      const viewport = window.innerHeight;
      // 0 when the body's top reaches the viewport top, 1 when its end is visible.
      const total = rect.height - viewport;
      const p = total <= 0 ? (rect.top <= 0 ? 1 : 0) : Math.min(1, Math.max(0, -rect.top / total));
      bar.style.transform = `scaleX(${p})`;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [targetId]);

  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-[3px]">
      <div
        ref={barRef}
        className="h-full origin-left bg-gradient-to-r from-accent to-accent-soft"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}
