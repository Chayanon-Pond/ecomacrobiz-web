"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { loadGsap } from "@/lib/animations/gsap";
import { isMotionEnabled, markMotionReady } from "@/lib/animations/motion";
import { setLenis } from "@/lib/animations/scroll-store";

/**
 * Global animation runtime (mounted once in the root layout):
 * - Lenis smooth scrolling driven by GSAP's ticker (single rAF loop).
 * - Generic scroll reveal for any element with [data-reveal].
 * All heavy code is dynamically imported after hydration.
 */
export function MotionRuntime() {
  const pathname = usePathname();

  // Lenis + ticker: once per app lifetime.
  useEffect(() => {
    if (!isMotionEnabled()) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    Promise.all([import("lenis"), loadGsap()]).then(
      ([{ default: Lenis }, { gsap, ScrollTrigger }]) => {
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
        markMotionReady();

        cleanup = () => {
          gsap.ticker.remove(tick);
          lenis.destroy();
          setLenis(null);
        };
      },
    );

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  // Reveal-on-scroll: re-scan after every route change.
  useEffect(() => {
    if (!isMotionEnabled()) return;
    let cancelled = false;
    let triggers: { kill: () => void }[] = [];

    loadGsap().then(({ gsap, ScrollTrigger }) => {
      if (cancelled) return;
      markMotionReady();
      const items = gsap.utils.toArray<HTMLElement>("[data-reveal]");
      if (items.length === 0) return;
      gsap.set(items, { opacity: 0, y: 40 });
      triggers = ScrollTrigger.batch(items, {
        start: "top 88%",
        once: true,
        onEnter: (batch) =>
          gsap.to(batch, {
            opacity: 1,
            y: 0,
            duration: 1.1,
            ease: "expo.out",
            stagger: 0.08,
            overwrite: true,
          }),
      });
      ScrollTrigger.refresh();
    });

    return () => {
      cancelled = true;
      triggers.forEach((t) => t.kill());
    };
  }, [pathname]);

  return null;
}
