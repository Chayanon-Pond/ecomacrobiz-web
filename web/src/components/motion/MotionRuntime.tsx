"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { gsapIfLoaded, loadGsap } from "@/lib/animations/gsap";
import { isMotionEnabled, markMotionReady } from "@/lib/animations/motion";
import { setLenis } from "@/lib/animations/scroll-store";

const REVEAL_MS = 1100;
const REVEAL_STAGGER_MS = 80;

/**
 * Global animation runtime (mounted once in the site layout):
 * - Generic scroll reveal for any element with [data-reveal]: an
 *   IntersectionObserver + CSS transition (globals.css), no GSAP needed, so
 *   it works right after hydration at almost no main-thread cost.
 * - Lenis smooth scrolling driven by GSAP's ticker (single rAF loop), loaded
 *   with GSAP on the first engagement (see loadGsap()).
 */
export function MotionRuntime() {
  const pathname = usePathname();

  // Lenis + ticker: once per app lifetime.
  useEffect(() => {
    if (!isMotionEnabled()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    Promise.all([loadGsap(), import("lenis")]).then(([{ gsap, ScrollTrigger }, { default: Lenis }]) => {
      if (cancelled) return;
      const lenis = new Lenis({
        lerp: 0.1,
        smoothWheel: true,
        // Touch keeps native momentum (best on iOS/iPad).
        syncTouch: false,
        anchors: { offset: -72 },
        autoRaf: false,
      });
      setLenis(lenis);
      lenis.on("scroll", ScrollTrigger.update);
      const tick = (time: number) => lenis.raf(time * 1000);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);

      cleanup = () => {
        gsap.ticker.remove(tick);
        lenis.destroy();
        setLenis(null);
      };
    });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Reveal-on-scroll: re-scan after every route change.
  useEffect(() => {
    if (!isMotionEnabled()) return;
    const items = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]:not(.revealed)"));

    // Slow hydration: the CSS fallback (2.5 s) may already be showing some
    // items. Keep those visible instead of hiding and re-revealing them.
    if (!document.documentElement.classList.contains("motion-ready")) {
      for (const el of items) {
        if (Number(getComputedStyle(el).opacity) > 0) el.classList.add("revealed", "reveal-done");
      }
    }
    markMotionReady();

    const reveal = (els: HTMLElement[]) => {
      els.forEach((el, i) => {
        const delay = i * REVEAL_STAGGER_MS;
        el.style.setProperty("--reveal-delay", `${delay}ms`);
        el.classList.add("revealed");
        // Drop the reveal transition afterwards so the element's own
        // transitions (hover etc.) apply again.
        window.setTimeout(() => el.classList.add("reveal-done"), REVEAL_MS + delay + 50);
      });
    };

    const io = new IntersectionObserver(
      (entries) => {
        const due = entries
          // In view (top 88% of the viewport) or already scrolled past.
          .filter((e) => e.isIntersecting || e.boundingClientRect.bottom < 0)
          .map((e) => e.target as HTMLElement);
        due.forEach((el) => io.unobserve(el));
        reveal(due);
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    items.filter((el) => !el.classList.contains("revealed")).forEach((el) => io.observe(el));

    // Scenes created before a client navigation need fresh positions.
    gsapIfLoaded()?.ScrollTrigger.refresh();

    return () => {
      io.disconnect();
    };
  }, [pathname]);

  return null;
}
