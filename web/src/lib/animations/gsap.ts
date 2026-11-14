/**
 * Lazy GSAP loader.
 *
 * GSAP + ScrollTrigger are only fetched in the browser, when motion is
 * enabled, and only once the visitor engages with the page (scroll, wheel,
 * touch, key, pointer) or it was opened already scrolled. Everything GSAP
 * drives is scroll-linked, so nothing is lost before that, and parsing +
 * scene setup stays out of the initial load (Total Blocking Time). Reveals
 * and entrance effects do not need GSAP (MotionRuntime + CSS).
 * Every animated section awaits `loadGsap()`; the promise is shared.
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

const ENGAGE_EVENTS = ["scroll", "wheel", "touchstart", "pointerdown", "pointermove", "keydown"] as const;

/** Resolves on the first sign of engagement (or immediately if already scrolled). */
export function whenEngaged(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return;
    if (window.scrollY > 0) return resolve();
    const done = () => {
      ENGAGE_EVENTS.forEach((e) => window.removeEventListener(e, done, true));
      resolve();
    };
    ENGAGE_EVENTS.forEach((e) => window.addEventListener(e, done, { capture: true, passive: true }));
  });
}

let loaded: GsapBundle | null = null;

/** The GSAP bundle if it has already loaded (never triggers a download). */
export function gsapIfLoaded(): GsapBundle | null {
  return loaded;
}

export function loadGsap(): Promise<GsapBundle> {
  if (!bundlePromise) {
    bundlePromise = whenEngaged().then(() => whenIdle(300)).then(() => Promise.all([
      import("gsap"),
      import("gsap/ScrollTrigger"),
    ])).then(([g, st]) => {
      const gsap = g.gsap;
      const ScrollTrigger = st.ScrollTrigger;
      gsap.registerPlugin(ScrollTrigger);
      gsap.defaults({ ease: "power3.out", duration: 1 });
      // iOS Safari: avoid refreshing on the address-bar resize (jank).
      ScrollTrigger.config({ ignoreMobileResize: true });
      loaded = { gsap, ScrollTrigger };
      return loaded;
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
