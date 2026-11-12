/**
 * Lazy GSAP loader.
 *
 * GSAP + ScrollTrigger are only fetched in the browser, after hydration, and
 * only when motion is enabled. Every animated section awaits `loadGsap()`;
 * the module promise is shared so the code is downloaded once.
 */
import type { gsap as GsapType } from "gsap";
import type { ScrollTrigger as ScrollTriggerType } from "gsap/ScrollTrigger";

export type GsapBundle = {
  gsap: typeof GsapType;
  ScrollTrigger: typeof ScrollTriggerType;
};

let bundlePromise: Promise<GsapBundle> | null = null;

/** Resolve when the main thread is idle (keeps animation code off the critical path). */
export function whenIdle(timeout = 1200): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      window.requestIdleCallback(() => resolve(), { timeout });
    } else {
      setTimeout(resolve, 200);
    }
  });
}

export function loadGsap(): Promise<GsapBundle> {
  if (!bundlePromise) {
    bundlePromise = whenIdle().then(() => Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
    ])).then(([g, st]) => {
      const gsap = g.gsap;
      const ScrollTrigger = st.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      gsap.defaults({ ease: "power3.out", duration: 1 });
      // iOS Safari: avoid refreshing on the address-bar resize (jank).
      ScrollTrigger.config({ ignoreMobileResize: true });
      return { gsap, ScrollTrigger };
    });
  }
  return bundlePromise;
}

/** Breakpoint conditions used with gsap.matchMedia(). */
export const MQ = {
  /** phones */
  mobile: "(max-width: 767px)",
  /** iPad portrait and up */
  tabletUp: "(min-width: 768px)",
  /** large tablets landscape and desktops */
  desktop: "(min-width: 1024px)",
  finePointer: "(hover: hover) and (pointer: fine)",
} as const;
