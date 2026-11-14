"use client";

import { useEffect, useRef, type RefObject } from "react";
import { loadGsap, type GsapBundle } from "./gsap";
import { isMotionEnabled } from "./motion";

type Setup = (bundle: GsapBundle, scope: HTMLElement) => void | (() => void);

/**
 * Resolves once `el` is within one viewport of the visible area, so scenes
 * further down the page are only built when the reader gets close.
 */
type Signal = { cancelled: boolean; stop?: () => void };

function whenNear(el: HTMLElement, signal: Signal): Promise<void> {
  if (typeof IntersectionObserver === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          resolve();
        }
      },
      { rootMargin: "100% 0px" },
    );
    signal.stop = () => io.disconnect();
    io.observe(el);
  });
}

/** Give the main thread back between scene setups (one task per scene, not one long task). */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Runs a GSAP setup scoped to `scope` once GSAP has lazy-loaded.
 * - Skipped entirely when the user prefers reduced motion.
 * - Built lazily: only when the scope is within a viewport of the screen,
 *   each scene in its own task (keeps Total Blocking Time low on load).
 * - Everything created inside is reverted on unmount (gsap.context).
 */
export function useGsap<T extends HTMLElement>(
  setup: Setup,
): RefObject<T | null> {
  const scope = useRef<T | null>(null);
  const setupRef = useRef(setup);

  useEffect(() => {
    setupRef.current = setup;
  });

  useEffect(() => {
    const el = scope.current;
    if (!el || !isMotionEnabled()) return;

    const signal: Signal = { cancelled: false };
    let revert: (() => void) | undefined;

    Promise.all([loadGsap(), whenNear(el, signal)]).then(async ([bundle]) => {
      await nextTask();
      if (signal.cancelled) return;
      let extraCleanup: void | (() => void);
      const ctx = bundle.gsap.context(() => {
        extraCleanup = setupRef.current(bundle, el);
      }, el);
      revert = () => {
        if (typeof extraCleanup === "function") extraCleanup();
        ctx.revert();
      };
    });

    return () => {
      signal.cancelled = true;
      signal.stop?.();
      revert?.();
    };
  }, []);

  return scope;
}
